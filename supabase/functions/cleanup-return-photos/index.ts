import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

    const now = new Date()

    // ===== 1. 30天照片清理: 从 Storage 删除过期照片文件 =====
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()

    const { data: expiredPhotos, error: fetchError } = await supabase
      .from('return_photos')
      .select('id, storage_path')
      .lt('created_at', thirtyDaysAgo)
      .is('photo_deleted_at', null)

    if (fetchError) {
      throw new Error(`Failed to fetch expired photos: ${fetchError.message}`)
    }

    let deletedStorageCount = 0
    let deletedStorageErrors = 0

    if (expiredPhotos && expiredPhotos.length > 0) {
      // 批量删除 Storage 文件
      const storagePaths = expiredPhotos.map((p) => p.storage_path)
      const { error: removeError } = await supabase.storage
        .from('return-photos')
        .remove(storagePaths)

      if (removeError) {
        console.error('Failed to remove some storage files:', removeError)
        // 回退到逐个删除
        for (const photo of expiredPhotos) {
          const { error: singleRemoveError } = await supabase.storage
            .from('return-photos')
            .remove([photo.storage_path])
          if (singleRemoveError) {
            deletedStorageErrors++
            console.error(`Failed to remove ${photo.storage_path}:`, singleRemoveError)
          } else {
            deletedStorageCount++
          }
        }
      } else {
        deletedStorageCount = expiredPhotos.length
      }

      // 标记照片为已删除（设置 photo_deleted_at）
      const photoIds = expiredPhotos.map((p) => p.id)
      const { error: updateError } = await supabase
        .from('return_photos')
        .update({ photo_deleted_at: now.toISOString() })
        .in('id', photoIds)

      if (updateError) {
        console.error('Failed to update photo_deleted_at:', updateError)
      }
    }

    // ===== 2. 1年元数据清理: 从数据库删除过期记录 =====
    const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString()

    const { data: expiredRecords, error: deleteError } = await supabase
      .from('return_photos')
      .delete()
      .lt('created_at', oneYearAgo)
      .select('id')

    if (deleteError) {
      throw new Error(`Failed to delete expired metadata: ${deleteError.message}`)
    }

    const deletedMetadataCount = expiredRecords?.length || 0

    const result = {
      message: 'Cleanup completed',
      photoCleanup: {
        scanned: expiredPhotos?.length || 0,
        storageDeleted: deletedStorageCount,
        storageErrors: deletedStorageErrors,
      },
      metadataCleanup: {
        deleted: deletedMetadataCount,
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
