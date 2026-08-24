import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Verify cron secret to prevent unauthorized calls
    const authHeader = req.headers.get('authorization')
    if (authHeader !== `Bearer ${Deno.env.get('CRON_SECRET')}`) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // 仅处理管理员明确删除测试/取消记录时登记的 Storage 清理队列。
    // 归还照片和元数据采用永久保留策略，不再执行任何按年龄清理。
    // 每次最多处理 100 个，失败项保留到下次定时任务重试，避免循环重试阻塞。
    const { data: queuedFiles, error: queueFetchError } = await supabase
      .from('storage_cleanup_queue')
      .select('id, storage_path')
      .order('created_at', { ascending: true })
      .limit(100)

    if (queueFetchError) {
      throw new Error(`Failed to fetch storage cleanup queue: ${queueFetchError.message}`)
    }

    const removedQueueIds: string[] = []
    let queuedStorageErrors = 0

    if (queuedFiles && queuedFiles.length > 0) {
      const { error: queuedRemoveError } = await supabase.storage
        .from('return-photos')
        .remove(queuedFiles.map((file) => file.storage_path))

      if (!queuedRemoveError) {
        removedQueueIds.push(...queuedFiles.map((file) => file.id))
      } else {
        console.error('Failed to remove queued storage files in batch:', queuedRemoveError)
        for (const file of queuedFiles) {
          const { error: singleRemoveError } = await supabase.storage
            .from('return-photos')
            .remove([file.storage_path])
          if (singleRemoveError) {
            queuedStorageErrors++
            console.error(`Failed to remove queued file ${file.storage_path}:`, singleRemoveError)
          } else {
            removedQueueIds.push(file.id)
          }
        }
      }

      if (removedQueueIds.length > 0) {
        const { error: queueDeleteError } = await supabase
          .from('storage_cleanup_queue')
          .delete()
          .in('id', removedQueueIds)
        if (queueDeleteError) {
          throw new Error(`Failed to clear storage cleanup queue: ${queueDeleteError.message}`)
        }
      }
    }

    const result = {
      message: 'Explicit storage cleanup queue processed',
      retentionPolicy: {
        returnPhotoFiles: 'permanent',
        returnPhotoMetadata: 'permanent',
        ageBasedDeletion: false,
      },
      queuedCleanup: {
        scanned: queuedFiles?.length || 0,
        storageDeleted: removedQueueIds.length,
        storageErrors: queuedStorageErrors,
      },
    }

    console.log('[cleanup-return-photos] Result:', JSON.stringify(result))

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: unknown) {
    console.error('[cleanup-return-photos] Error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : '服务器内部错误' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
