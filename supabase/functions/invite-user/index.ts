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

    // 验证调用者是 super_admin
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

    if (profile.role !== 'super_admin' || profile.status !== 'active') {
      return new Response(
        JSON.stringify({ error: '仅超级管理员可邀请用户' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 解析请求体
    const { email, displayName, role, password } = await req.json()

    if (!email || !displayName || !password) {
      return new Response(
        JSON.stringify({ error: '邮箱、姓名和密码为必填项' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (password.length < 6) {
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

    const emailExists = existingUsers.users.some((u: any) =>
      u.email.toLowerCase() === email.toLowerCase()
    )

    if (emailExists) {
      return new Response(
        JSON.stringify({ error: '该邮箱已注册' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 使用 admin.createUser 创建用户（无需邮箱验证）
    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // 直接标记邮箱已验证，无需用户验证
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
