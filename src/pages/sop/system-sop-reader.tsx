import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react'
import { Liquid } from 'liquid-gooey'
import { ArrowLeft, ArrowRight, ArrowUp, ArrowDown, BookOpenCheck, ImageOff, LoaderCircle, Plus, RotateCcw, Save, Trash2, Upload, X, ZoomIn, ZoomOut } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { PersistedSopItem } from '@/services/sop.service'
import { getSopScreenshot } from './system-sop-screenshots'

interface SystemSopReaderProps {
  title: string
  description: string
  steps: PersistedSopItem[]
  entry?: { href: string; label: string }
  editing: boolean
  saving: boolean
  dirty: boolean
  saveError: string | null
  undoMessage?: string
  onUndo: () => void
  onSave: () => void
  onChangeSteps: (steps: PersistedSopItem[], removed?: boolean) => void
}

function StepScreenshot({ step, zoomed, onToggleZoom }: { step: PersistedSopItem; zoomed: boolean; onToggleZoom: () => void }) {
  const source = getSopScreenshot(step)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const viewportId = useId()
  const viewportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!zoomed) return
    const frame = window.requestAnimationFrame(() => viewportRef.current?.focus({ preventScroll: true }))
    return () => window.cancelAnimationFrame(frame)
  }, [zoomed])

  return (
    <figure className={`sop-reader-shot ${zoomed ? 'is-zoomed' : ''}`} aria-busy={Boolean(source) && state === 'loading'}>
      <div id={viewportId} ref={viewportRef} className="sop-reader-shot__viewport" tabIndex={zoomed ? 0 : undefined} aria-label={zoomed ? '放大的操作截图，可滚动查看' : undefined}>
        {source && state !== 'error' && (
          <button type="button" className="sop-reader-shot__image-button" aria-label={zoomed ? '恢复完整截图显示' : `放大操作截图：${step.label}`}
            aria-pressed={zoomed} aria-controls={viewportId} tabIndex={zoomed ? -1 : 0} disabled={state !== 'ready'} onClick={onToggleZoom}>
            <img key={attempt} src={source} alt={`操作截图：${step.label}`} width={1280} height={860} draggable={false}
              referrerPolicy="no-referrer" className={state === 'ready' ? 'is-ready' : ''}
              onLoad={() => setState('ready')} onError={() => setState('error')} />
          </button>
        )}
        {source && state === 'loading' && <div className="sop-reader-shot__loading" role="status"><LoaderCircle className="is-spinning" aria-hidden="true" /><span>正在加载操作截图</span></div>}
        {(!source || state === 'error') && (
          <div className="sop-reader-shot__empty" role="status">
            <ImageOff aria-hidden="true" />
            <strong>{source ? '截图加载失败' : '这一步尚未配置截图'}</strong>
            <p>{source ? '请检查网络后重试，或联系管理员更新截图。' : '请管理员在编辑模式中上传对应操作截图。'}</p>
            {source && <button type="button" className="sop-text-button" onClick={() => { setState('loading'); setAttempt((value) => value + 1) }}>重新加载</button>}
          </div>
        )}
      </div>
      <figcaption>{step.screenshot_caption || (step.screenshot ? '管理员提供的操作截图' : '实际系统界面 · 隔离演示数据 · 标记区域为本步操作位置')}</figcaption>
    </figure>
  )
}

export function SystemSopReader({ title, description, steps, entry, editing, saving, dirty, saveError, undoMessage, onUndo, onSave, onChangeSteps }: SystemSopReaderProps) {
  const [open, setOpen] = useState(true)
  const [index, setIndex] = useState(0)
  const [finished, setFinished] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const uploadSequence = useRef(0)
  const currentIndex = Math.max(0, Math.min(index, steps.length - 1))
  const step = steps[currentIndex]
  const progressStart = Math.max(0, Math.min(currentIndex - 3, steps.length - 7))

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduceMotion(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflowY
    document.body.style.overflowY = 'hidden'
    return () => { document.body.style.overflowY = previousOverflow }
  }, [open])

  useEffect(() => {
    return () => { uploadSequence.current += 1 }
  }, [])

  const goTo = (nextIndex: number) => {
    setIndex(Math.max(0, Math.min(nextIndex, steps.length - 1)))
    setZoomed(false)
    setUploadError(null)
    bodyRef.current?.scrollTo({ top: 0, behavior: 'instant' })
  }

  const patchStep = (patch: Partial<PersistedSopItem>) => {
    if (!step) return
    onChangeSteps(steps.map((item) => item.id === step.id ? { ...item, ...patch } : item))
    setFinished(false)
  }

  const addStep = () => {
    const nextIndex = steps.length ? currentIndex + 1 : 0
    const next = [...steps]
    next.splice(nextIndex, 0, { id: `system-step-${crypto.randomUUID()}`, label: '填写本步操作说明', screenshot: '' })
    onChangeSteps(next)
    setIndex(nextIndex)
    setFinished(false)
  }

  const moveStep = (direction: -1 | 1) => {
    const nextIndex = currentIndex + direction
    if (nextIndex < 0 || nextIndex >= steps.length) return
    const next = [...steps]
    ;[next[currentIndex], next[nextIndex]] = [next[nextIndex], next[currentIndex]]
    onChangeSteps(next)
    goTo(nextIndex)
  }

  const uploadScreenshot = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !step) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 1024 * 1024) {
      setUploadError('请选择不超过 1 MB 的 PNG、JPG 或 WebP 截图。')
      return
    }
    const sequence = ++uploadSequence.current
    const targetId = step.id
    setUploading(true)
    setUploadError(null)
    try {
      const image = await createImageBitmap(file)
      image.close()
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('无法读取所选图片，请重新选择。'))
        reader.readAsDataURL(file)
      })
      if (sequence !== uploadSequence.current) return
      onChangeSteps(steps.map((item) => item.id === targetId ? {
        ...item, screenshot: data, screenshot_caption: '管理员提供的操作截图',
      } : item))
      setFinished(false)
    } catch {
      if (sequence === uploadSequence.current) setUploadError('图片无法读取，请使用有效的 PNG、JPG 或 WebP 截图。')
    } finally {
      if (sequence === uploadSequence.current) setUploading(false)
    }
  }

  const next = () => {
    if (currentIndex < steps.length - 1) goTo(currentIndex + 1)
    else { setFinished(true); setOpen(false) }
  }

  return (
    <section className="sop-system-guide" aria-label="系统图文指引">
      <div className="sop-system-guide__summary">
        <BookOpenCheck aria-hidden="true" />
        <div><h2>{title}</h2><p>{description}</p><span>{finished ? `已读完 ${steps.length} 步，可随时回看` : `${steps.length} 步图文说明 · 一次只看一个动作`}</span></div>
        <button type="button" className="sop-reader-start" onClick={() => setOpen(true)}>{finished ? '回看指引' : currentIndex > 0 ? '继续阅读' : '开始阅读'}<ArrowRight aria-hidden="true" /></button>
      </div>
      <p className="sop-system-guide__note">指引只负责讲解，不会替你提交申请、执行审批或修改系统数据。</p>

      <dialog ref={dialogRef} className={`sop-reader-dialog ${editing ? 'is-editing' : ''}`} aria-labelledby="sop-reader-title" aria-describedby="sop-reader-description"
        onClose={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]'))
            .filter((node) => node.getClientRects().length > 0)
          const first = controls[0]
          const last = controls[controls.length - 1]
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last?.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first?.focus()
          }
        }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return
          const rect = event.currentTarget.getBoundingClientRect()
          if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) setOpen(false)
        }}>
        <header className="sop-reader-head">
          <div><span>系统使用 SOP · {steps.length} 步</span><h2 id="sop-reader-title">{title}</h2><p id="sop-reader-description">截图会先完整显示；看不清时点击截图放大，再点击右下角继续。</p></div>
          <div className="sop-reader-head__actions">
            {editing && <button type="button" className="sop-save-button" aria-label={saving ? '保存中' : '保存 SOP'} onClick={onSave} disabled={!dirty || saving || uploading}>{saving ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : <Save aria-hidden="true" />}<span>{saving ? '保存中' : '保存 SOP'}</span></button>}
            <button type="button" className="sop-icon-button" aria-label="关闭图文指引" onClick={() => setOpen(false)}><X aria-hidden="true" /></button>
          </div>
        </header>

        <div className="sop-reader-body" ref={bodyRef}>
          {undoMessage && <div className="sop-reader-undo" role="status"><span>{undoMessage}</span><button type="button" className="sop-text-button" onClick={onUndo}>撤销</button></div>}
          {step ? <div className="sop-reader-page" key={step.id} data-step-id={step.id}>
            <div className="sop-reader-copy" aria-live="polite" aria-atomic="true">
              <span className="sop-reader-step-number">第 {currentIndex + 1} 步 / 共 {steps.length} 步</span>
              <h3>{step.label}</h3>
            </div>
            <div className="sop-reader-visual">
              <StepScreenshot key={getSopScreenshot(step)} step={step} zoomed={zoomed} onToggleZoom={() => setZoomed((value) => !value)} />
              {getSopScreenshot(step) && <button type="button" className="sop-reader-zoom" aria-pressed={zoomed} onClick={() => setZoomed((value) => !value)}>{zoomed ? <ZoomOut aria-hidden="true" /> : <ZoomIn aria-hidden="true" />}{zoomed ? '适应窗口' : '放大截图'}</button>}
            </div>
            {editing && <div className="sop-reader-editor">
              <label><span>本步操作说明</span><textarea value={step.label} maxLength={500} disabled={uploading || saving} onChange={(event) => patchStep({ label: event.target.value })} /></label>
              <label><span>截图地址</span><input value={step.screenshot?.startsWith('data:') ? '' : step.screenshot ?? getSopScreenshot(step)}
                disabled={uploading || saving} placeholder={step.screenshot?.startsWith('data:') ? '已选择本地截图；填写网址可替换' : 'https://… 或站内图片路径'}
                onChange={(event) => patchStep({ screenshot: event.target.value.trim() })} /></label>
              <div className="sop-reader-editor__tools">
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => void uploadScreenshot(event)} />
                <button type="button" className="sop-text-button" disabled={uploading || saving} onClick={() => fileRef.current?.click()}>{uploading ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : <Upload aria-hidden="true" />}{uploading ? '读取中' : '上传截图'}</button>
                <button type="button" className="sop-icon-button" disabled={currentIndex === 0 || uploading || saving} onClick={() => moveStep(-1)} aria-label="上移本步"><ArrowUp aria-hidden="true" /></button>
                <button type="button" className="sop-icon-button" disabled={currentIndex === steps.length - 1 || uploading || saving} onClick={() => moveStep(1)} aria-label="下移本步"><ArrowDown aria-hidden="true" /></button>
                <button type="button" className="sop-text-button" disabled={uploading || saving} onClick={addStep}><Plus aria-hidden="true" />插入下一步</button>
                <button type="button" className="sop-icon-button sop-icon-button--danger" disabled={uploading || saving} onClick={() => { onChangeSteps(steps.filter((item) => item.id !== step.id), true); goTo(Math.max(0, currentIndex - 1)) }} aria-label="删除本步"><Trash2 aria-hidden="true" /></button>
              </div>
              <span className="sop-reader-editor__helper">支持 PNG / JPG / WebP，单张不超过 1 MB。截图随 SOP 保存，上传前请遮盖真实个人资料与密钥。</span>
              <p className="sop-reader-error" role="alert">{uploadError || saveError || ''}</p>
            </div>}
          </div> : <div className="sop-reader-empty"><BookOpenCheck aria-hidden="true" /><h3>还没有图文步骤</h3><p>{editing ? '先添加一个步骤，再上传对应截图。' : '请联系管理员补充这条系统指引。'}</p>{editing && <button type="button" className="sop-reader-start" onClick={addStep}><Plus aria-hidden="true" />添加第一步</button>}</div>}
        </div>

        <footer className="sop-reader-footer">
          <button type="button" className="sop-reader-back" disabled={currentIndex === 0 || uploading} onClick={() => goTo(currentIndex - 1)}><ArrowLeft aria-hidden="true" /><span>上一步</span></button>
          <div className="sop-reader-progress" role="progressbar" aria-label="指引阅读位置" aria-valuemin={0} aria-valuemax={steps.length || 1} aria-valuenow={step ? currentIndex + 1 : 0}>
            <Liquid blur={2} contrast={18} fill="var(--color-paper-3)" className="sop-reader-progress__liquid">
              {steps.slice(progressStart, progressStart + 7).map((item, offset) => <Liquid.Item key={item.id} morph={{ shape: !reduceMotion, bounce: 0, contentBlur: 0 }}><span className={`sop-reader-progress__item ${progressStart + offset === currentIndex ? 'is-current' : ''}`}>{progressStart + offset === currentIndex ? `${currentIndex + 1} / ${steps.length}` : ''}</span></Liquid.Item>)}
            </Liquid>
          </div>
          <Liquid blur={6} contrast={18} fill="var(--color-accent)" className="sop-reader-next-liquid">
            <Liquid.Item morph={{ shape: !reduceMotion, speed: 1.15, bounce: 0, contentBlur: 0 }} className="sop-reader-next-shape">
              <button type="button" className="sop-reader-next" disabled={!step || uploading} onClick={next}><span>{currentIndex === steps.length - 1 ? '完成指引' : '下一步'}</span><ArrowRight aria-hidden="true" /></button>
            </Liquid.Item>
          </Liquid>
        </footer>
      </dialog>
      {finished && <div className="sop-system-guide__finish"><span>阅读完成不代表业务已处理。</span><button type="button" className="sop-text-button" onClick={() => { goTo(0); setFinished(false); setOpen(true) }}><RotateCcw aria-hidden="true" />重新阅读</button>{entry && <Link className="sop-entry-link" to={entry.href}>{entry.label}<ArrowRight aria-hidden="true" /></Link>}</div>}
    </section>
  )
}
