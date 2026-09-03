import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.0'

import { bearerToken, configuredList } from '../_shared/request-security.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Supabase service environment is incomplete' }, 500)
  }

  const token = bearerToken(req)
  if (!token) return jsonResponse({ error: 'Unauthorized' }, 401)

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: authData, error: authError } = await supabase.auth.getUser(token)
  if (authError || !authData.user) return jsonResponse({ error: 'Unauthorized' }, 401)

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', authData.user.id)
    .maybeSingle()
  if (profileError) return jsonResponse({ error: profileError.message }, 500)
  if (profile?.status !== 'active' || profile.role !== 'super_admin') {
    return jsonResponse({ error: 'Forbidden' }, 403)
  }

  return jsonResponse({
    webhookConfigured: Boolean(Deno.env.get('WECOM_WEBHOOK_URL')?.trim()),
    approvalRecipientsConfigured: configuredList('APPROVAL_CC_MOBILES').length > 0,
    returnRecipientsConfigured: configuredList('RETURN_MENTION_PROFILE_IDS').length > 0,
    managedBy: 'supabase_edge_function_secrets',
  })
})
