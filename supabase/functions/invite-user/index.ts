import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 验证调用者是已登录的管理员
    const authHeader = req.headers.get('authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: '未提供认证信息' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    // 用调用者的 token 创建客户端，验证身份
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    // 获取当前用户
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: '认证失败' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 验证调用者是 super_admin 或 admin
    const { data: profile, error: profileError } = await userClient
      .from('profiles')
      .select('role, status')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return new Response(
        JSON.stringify({ error: '无法获取用户信息' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!['super_admin', 'admin'].includes(profile.role) || profile.status !== 'active') {
      return new Response(
        JSON.stringify({ error: '仅管理员可邀请或管理用户' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 解析请求体
    const { email, displayName, role, password } = await req.json()

    if (!email || !displayName) {
      return new Response(
        JSON.stringify({ error: '邮箱和姓名为必填项' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (password && password.length < 6) {
      return new Response(
        JSON.stringify({ error: '密码至少6位' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const validRoles = ['user', 'approver', 'admin']
    const userRole = validRoles.includes(role) ? role : 'user'

    // 使用 service role key 创建管理员客户端
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    // 检查邮箱是否已注册
    const { data: existingUsers, error: listError } = await adminClient.auth.admin.listUsers()
    if (listError) {
      console.error('listUsers error:', listError)
      return new Response(
        JSON.stringify({ error: '检查用户失败: ' + listError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const existingUser = existingUsers.users.find((u: any) =>
      u.email.toLowerCase() === email.toLowerCase()
    )

    if (existingUser) {
      // ===== 邮箱已存在 → 更新模式 =====

      // 检查 profile 是否存在
      const { data: existingProfile, error: profileFetchError } = await adminClient
        .from('profiles')
        .select('id, display_name, role, status')
        .eq('id', existingUser.id)
        .single()

      if (profileFetchError || !existingProfile) {
        // auth.users 有但 profiles 没有 → 补建 profile
        const { error: insertError } = await adminClient
          .from('profiles')
          .insert({
            id: existingUser.id,
            display_name: displayName,
            email: email,
            role: userRole,
            status: 'pending_approval',
            is_active: true,
          })

        if (insertError) {
          console.error('insert profile error:', insertError)
          return new Response(
            JSON.stringify({ error: '补建用户资料失败: ' + insertError.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // 可选：更新 auth.user_metadata
        await adminClient.auth.admin.updateUserById(existingUser.id, {
          user_metadata: {
            ...existingUser.user_metadata,
            display_name: displayName,
            role: userRole,
            invite_by_admin: 'true',
          },
        })

        return new Response(
          JSON.stringify({
            action: 'profile_created',
            message: '用户资料已补充完成，请在待审批中通过',
            userId: existingUser.id,
            email: existingUser.email,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // profile 已存在 → 更新角色和显示名
      const updateData: Record<string, any> = {
        display_name: displayName,
        role: userRole,
        updated_at: new Date().toISOString(),
      }

      // 如果当前是 pending_approval 且调用者是 super_admin，可以直接激活
      if (existingProfile.status === 'pending_approval' && profile.role === 'super_admin') {
        updateData.status = 'active'
      }

      const { error: updateError } = await adminClient
        .from('profiles')
        .update(updateData)
        .eq('id', existingUser.id)

      if (updateError) {
        console.error('update profile error:', updateError)
        return new Response(
          JSON.stringify({ error: '更新用户失败: ' + updateError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // 如果提供了新密码，更新 auth 用户密码
      if (password) {
        const { error: pwdError } = await adminClient.auth.admin.updateUserById(existingUser.id, {
          password: password,
        })
        if (pwdError) {
          console.error('update password warning:', pwdError)
          // 密码更新失败不阻断主流程
        }
      }

      // 更新 auth metadata
      await adminClient.auth.admin.updateUserById(existingUser.id, {
        user_metadata: {
          ...existingUser.user_metadata,
          display_name: displayName,
          role: userRole,
        },
      })

      const wasPending = existingProfile.status === 'pending_approval'
      const isNowActive = updateData.status === 'active'

      return new Response(
        JSON.stringify({
          action: wasPending ? 'approved' : 'updated',
          message: isNowActive
            ? '用户已更新并自动审批通过'
            : wasPending
              ? '用户信息已更新（待审批状态不变，请手动通过）'
              : '用户信息已更新',
          userId: existingUser.id,
          email: existingUser.email,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ===== 邮箱不存在 → 创建新模式 =====

    if (!password) {
      return new Response(
        JSON.stringify({ error: '新用户必须设置初始密码' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 使用 admin.createUser 创建用户（无需邮箱验证）
    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: displayName,
        role: userRole,
        invite_by_admin: 'true',
      },
    })

    if (createError) {
      console.error('createUser error:', createError)
      return new Response(
        JSON.stringify({ error: '创建用户失败: ' + createError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        action: 'created',
        message: '用户创建成功',
        userId: newUser.user.id,
        email: newUser.user.email,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
