import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'

import {

  Activity,

  AlertTriangle,

  ArrowUpRight,

  Bell,

  CalendarDays,

  CheckCircle2,

  Camera,


  CircleHelp,

  ClipboardList,

  Clock3,

  Factory,

  Filter,

  LayoutDashboard,

  Image as ImageIcon,

  LogOut,

  Menu,

  MoreHorizontal,

  Package,

  Plus,

  Search,


  Sparkles,

  Shirt,


  Users,

  X,

} from 'lucide-react'

import api, { setAuthToken } from './services/api'

import './App.css'

type UserRole = 'MERCHANDISER' | 'SUPERVISOR' | 'BUYER'

type LoggedInUser = {

  id: string

  name: string

  email: string

  role: UserRole

  buyerId: string | null

}

type LoginResponse = {

  message: string

  token: string

  user: LoggedInUser

}

type ApiMilestone = {

  id: string

  stage: string

  plannedDate: string

  actualDate?: string | null

  status: string

}

type ApiRiskAnalysis = {
  status: 'ON_TRACK' | 'AT_RISK' | 'DELAYED' | 'COMPLETED'
  reason: string
  currentStage: string | null
  remainingQuantity: number
  daysLeft: number
  recentOutputPieces: number
  reportingDays: number
  lookbackDays: number
  requiredDailyRate: number | null
  actualDailyRate: number
  projectedDays: number | null
  bufferDays: number | null
  earlyWarningDays: number
}

type ApiProductionUpdate = {
  id: string
  stage: string
  quantity: number
  photoUrl?: string | null
  createdAt: string
}

type ApiOrder = {

  id: string

  poNumber: string

  buyerId: string

  styleName: string

  colour: string

  totalQuantity: number

  completedQty: number

  exFactoryDate: string

  status: string

  unitName: string

  buyer?: {

    companyName: string

    country?: string | null

  }

  milestones?: ApiMilestone[]

  updates?: ApiProductionUpdate[]

  riskAnalysis?: ApiRiskAnalysis

}

type Order = {

  id: string

  po: string

  buyer: string

  country: string

  style: string

  colour: string

  quantity: number

  completed: number

  stage: string

  unit: string

  shipDate: string

  shipDateISO: string

  risk: 'On track' | 'At risk' | 'Delayed' | 'Completed'

  riskAnalysis?: ApiRiskAnalysis

  milestones: ApiMilestone[]

  updates: ApiProductionUpdate[]

}

// Only expose destinations that have a working screen for that role.
const navigation = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'Orders', icon: ClipboardList },
  { label: 'Production', icon: Factory },
  { label: 'TNA Calendar', icon: CalendarDays },
]

const secondaryNavigation = [
  { label: 'AI Review', icon: Sparkles },
  { label: 'Buyers', icon: Users },
]

const supervisorNavigation = [
  { label: 'Daily update', icon: Factory },
]

const buyerNavigation = [
  { label: 'My orders', icon: ClipboardList },
]

const formatNumber = (value: number) =>

  new Intl.NumberFormat('en-IN').format(value)

const formatDate = (value: string) => {

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return '—'

  return date.toLocaleDateString('en-GB', {

    day: '2-digit',

    month: 'short',

    year: 'numeric',

  })

}

const mapRisk = (status: string): Order['risk'] => {

  switch (status) {

    case 'AT_RISK':

      return 'At risk'

    case 'DELAYED':

      return 'Delayed'

    case 'COMPLETED':

      return 'Completed'

    default:

      return 'On track'

  }

}

const mapOrder = (item: ApiOrder): Order => {

  const milestones = [...(item.milestones ?? [])].sort(

    (a, b) =>

      new Date(a.plannedDate).getTime() -

      new Date(b.plannedDate).getTime(),

  )

  const currentMilestone = milestones.find(

    (milestone) => milestone.status !== 'COMPLETED',

  )

  const latestMilestone = milestones[milestones.length - 1]

  return {

    id: item.id,

    po: item.poNumber,

    buyer: item.buyer?.companyName ?? 'Buyer',

    country: item.buyer?.country ?? '—',

    style: item.styleName,

    colour: item.colour,

    quantity: item.totalQuantity,

    completed: item.completedQty,

    stage:

      item.riskAnalysis?.currentStage ??

      currentMilestone?.stage ??

      latestMilestone?.stage ??

      'Not specified',

    unit: item.unitName,

    shipDate: formatDate(item.exFactoryDate),

    shipDateISO: item.exFactoryDate,

    risk: mapRisk(item.riskAnalysis?.status ?? item.status),

    riskAnalysis: item.riskAnalysis,

    milestones: item.milestones ?? [],

    updates: item.updates ?? [],

  }

}

// Returns the ISO-8601 week containing the order's ex-factory date.
// UTC is used because API dates are stored as ISO timestamps and must not
// shift into a different week when the browser's local timezone changes.
function getIsoShipWeek(value: string): { key: string; label: string } | null {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null

  const date = new Date(Date.UTC(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate(),
  ))

  const weekday = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - weekday)

  const isoYear = date.getUTCFullYear()
  const yearStart = new Date(Date.UTC(isoYear, 0, 1))
  const weekNumber = Math.ceil(
    (((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7,
  )

  return {
    key: `${isoYear}-W${String(weekNumber).padStart(2, '0')}`,
    label: `Week ${weekNumber}, ${isoYear}`,
  }
}

type OfflineSubmissionStatus = 'QUEUED' | 'SYNCING' | 'FAILED'

type OfflineProductionSubmission = {
  clientRequestId: string
  userId: string
  orderId: string
  stage: string
  quantity: number
  issueNote: string
  photoBlob?: Blob
  photoName?: string
  photoType?: string
  uploadedPhotoUrl?: string
  createdAt: string
  status: OfflineSubmissionStatus
  lastError?: string
}

const OFFLINE_DB_NAME = 'stitchflow-supervisor-offline'
const OFFLINE_DB_VERSION = 1
const OFFLINE_STORE_NAME = 'production-submissions'

function openOfflineDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('This browser does not support offline storage.'))
      return
    }

    const request = window.indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(OFFLINE_STORE_NAME)) {
        const store = db.createObjectStore(OFFLINE_STORE_NAME, {
          keyPath: 'clientRequestId',
        })
        store.createIndex('userId', 'userId', { unique: false })
        store.createIndex('createdAt', 'createdAt', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Unable to open offline storage.'))
  })
}

async function saveOfflineSubmission(item: OfflineProductionSubmission): Promise<void> {
  const db = await openOfflineDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(OFFLINE_STORE_NAME, 'readwrite')
      transaction.objectStore(OFFLINE_STORE_NAME).put(item)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Unable to save offline report.'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Offline report save was interrupted.'))
    })
  } finally {
    db.close()
  }
}

async function getOfflineSubmissions(userId: string): Promise<OfflineProductionSubmission[]> {
  const db = await openOfflineDatabase()
  try {
    return await new Promise<OfflineProductionSubmission[]>((resolve, reject) => {
      const transaction = db.transaction(OFFLINE_STORE_NAME, 'readonly')
      const request = transaction.objectStore(OFFLINE_STORE_NAME).index('userId').getAll(userId)
      request.onsuccess = () => {
        const items = request.result as OfflineProductionSubmission[]
        resolve(items.sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
      }
      request.onerror = () => reject(request.error ?? new Error('Unable to read offline reports.'))
    })
  } finally {
    db.close()
  }
}

async function removeOfflineSubmission(clientRequestId: string): Promise<void> {
  const db = await openOfflineDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(OFFLINE_STORE_NAME, 'readwrite')
      transaction.objectStore(OFFLINE_STORE_NAME).delete(clientRequestId)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Unable to clear synced report.'))
    })
  } finally {
    db.close()
  }
}

type ProductionUpdateHistoryItem = {

  id: string

  stage: string

  quantity: number

  issueNote?: string | null

  photoUrl?: string | null

  createdAt: string

  user?: { name: string }

  order?: { poNumber: string; unitName?: string }

}

type ProductionUpdateHistoryResponse = {

  success: boolean

  updates: ProductionUpdateHistoryItem[]

}

type SupervisorWorkspaceProps = {

  currentUserId: string

  orders: Order[]

  ordersLoading: boolean

  refreshOrders: () => Promise<void>

}

function SupervisorWorkspace({

  currentUserId,

  orders,

  ordersLoading,

  refreshOrders,

}: SupervisorWorkspaceProps) {

  const [selectedOrderId, setSelectedOrderId] = useState('')

  const [stage, setStage] = useState('STITCHING')

  const [quantity, setQuantity] = useState('')

  const [issueNote, setIssueNote] = useState('')

  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null)

  const [photoPreview, setPhotoPreview] = useState('')

  const [cameraOpen, setCameraOpen] = useState(false)

  const [cameraError, setCameraError] = useState('')

  const videoRef = useRef<HTMLVideoElement | null>(null)

  const cameraStreamRef = useRef<MediaStream | null>(null)

  const [submitting, setSubmitting] = useState(false)

  const [success, setSuccess] = useState('')

  const [error, setError] = useState('')

  const [history, setHistory] = useState<ProductionUpdateHistoryItem[]>([])

  const [historyLoading, setHistoryLoading] = useState(true)

  const [historyError, setHistoryError] = useState('')

  const [offlineQueue, setOfflineQueue] = useState<OfflineProductionSubmission[]>([])

  const [isOnline, setIsOnline] = useState(() => navigator.onLine)

  const [isSyncingQueue, setIsSyncingQueue] = useState(false)

  const syncInProgressRef = useRef(false)

  const loadHistory = useCallback(async () => {
    try {
      const response = await api.get<ProductionUpdateHistoryResponse>(
        '/production-updates/history',
      )
      setHistory(response.data.updates ?? [])
    } catch (err: unknown) {
      const message = (
        err as { response?: { data?: { message?: string } } }
      ).response?.data?.message
      setHistoryError(message || 'Unable to load production history.')
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  const refreshOfflineQueue = useCallback(async () => {
    if (!currentUserId) {
      setOfflineQueue([])
      return
    }
    try {
      const items = await getOfflineSubmissions(currentUserId)
      setOfflineQueue(items)
    } catch (queueError) {
      setError(queueError instanceof Error ? queueError.message : 'Unable to read the offline queue.')
    }
  }, [currentUserId])

  const syncQueuedSubmissions = useCallback(async (): Promise<number> => {
    if (!navigator.onLine || !currentUserId || syncInProgressRef.current) return 0

    syncInProgressRef.current = true
    setIsSyncingQueue(true)
    let syncedCount = 0

    try {
      const pendingItems = await getOfflineSubmissions(currentUserId)

      for (const queuedItem of pendingItems) {
        let workingItem: OfflineProductionSubmission = queuedItem
        try {
          workingItem = {
            ...queuedItem,
            status: 'SYNCING',
            lastError: undefined,
          }
          await saveOfflineSubmission(workingItem)
          await refreshOfflineQueue()

          let uploadedPhotoUrl = workingItem.uploadedPhotoUrl

          if (workingItem.photoBlob && !uploadedPhotoUrl) {
            const formData = new FormData()
            formData.append('orderId', workingItem.orderId)
            formData.append(
              'photo',
              workingItem.photoBlob,
              workingItem.photoName || `production-${workingItem.clientRequestId}.jpg`,
            )

            const uploadResponse = await api.post<{ photoUrl?: string; url?: string }>(
              '/production-photos/upload',
              formData,
              { headers: { 'Content-Type': 'multipart/form-data' } },
            )

            uploadedPhotoUrl = uploadResponse.data.photoUrl ?? uploadResponse.data.url
            if (!uploadedPhotoUrl) {
              throw new Error('Photo upload did not return a URL. The report remains queued.')
            }

            // Persist the uploaded URL before creating the report. A retry will
            // reuse the same image instead of uploading duplicate files.
            workingItem = { ...workingItem, uploadedPhotoUrl }
            await saveOfflineSubmission(workingItem)
          }

          const updateResponse = await api.post<{
            message?: string
            update?: { id?: string }
          }>('/production-updates', {
            clientRequestId: workingItem.clientRequestId,
            orderId: workingItem.orderId,
            stage: workingItem.stage,
            quantity: workingItem.quantity,
            issueNote: workingItem.issueNote || undefined,
            photoUrl: uploadedPhotoUrl,
          })

          const updateId = updateResponse.data.update?.id
          if (workingItem.issueNote && updateId) {
            try {
              await api.post(`/issue-reasons/classify/${encodeURIComponent(updateId)}`)
            } catch {
              // The production update is already saved. Do not retry the
              // production POST just because the AI provider is unavailable.
            }
          }

          await removeOfflineSubmission(workingItem.clientRequestId)
          syncedCount += 1
        } catch (syncError: unknown) {
          const responseMessage = (
            syncError as { response?: { data?: { message?: string } } }
          ).response?.data?.message
          const message = responseMessage ?? (
            syncError instanceof Error
              ? syncError.message
              : 'Sync failed. The report is safely retained on this device.'
          )

          await saveOfflineSubmission({
            ...workingItem,
            status: 'FAILED',
            lastError: String(message),
          })
          // Stop at the first failed item to preserve submission order.
          break
        }
      }
    } catch (queueError) {
      setError(queueError instanceof Error ? queueError.message : 'Unable to sync queued reports.')
    } finally {
      syncInProgressRef.current = false
      setIsSyncingQueue(false)
      await refreshOfflineQueue()
    }

    if (syncedCount > 0) {
      setHistoryLoading(true)
      setHistoryError('')
      await Promise.all([refreshOrders(), loadHistory()])
    }

    return syncedCount
  }, [currentUserId, loadHistory, refreshOfflineQueue, refreshOrders])

  useEffect(() => {
    void refreshOfflineQueue()
  }, [refreshOfflineQueue])

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      void syncQueuedSubmissions()
    }
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    if (navigator.onLine) {
      void syncQueuedSubmissions()
    }

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [syncQueuedSubmissions])

  // Load initial history directly in the effect. Keeping the request here
  // avoids calling a state-updating helper synchronously from an effect.
  useEffect(() => {
    let active = true

    const fetchInitialHistory = async () => {
      try {
        const response = await api.get<ProductionUpdateHistoryResponse>(
          '/production-updates/history',
        )
        if (active) {
          setHistory(response.data.updates ?? [])
        }
      } catch (err: unknown) {
        const message = (
          err as { response?: { data?: { message?: string } } }
        ).response?.data?.message
        if (active) {
          setHistoryError(message || 'Unable to load production history.')
        }
      } finally {
        if (active) {
          setHistoryLoading(false)
        }
      }
    }

    void fetchInitialHistory()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {

    if (orders.length > 0 && !selectedOrderId) {

      setSelectedOrderId(orders[0].id)

    }

  }, [orders, selectedOrderId])

  const selectedOrder = orders.find(

    (order) => order.id === selectedOrderId,

  )

  useEffect(() => {

    if (!cameraOpen) return

    let active = true

    const startCamera = async () => {

      try {

        if (!navigator.mediaDevices?.getUserMedia) {

          throw new Error('Camera access is not supported here. Use localhost or a supported mobile browser.')

        }

        const stream = await navigator.mediaDevices.getUserMedia({

          video: { facingMode: { ideal: 'environment' } },

          audio: false,

        })

        if (!active) {

          stream.getTracks().forEach((track) => track.stop())

          return

        }

        cameraStreamRef.current = stream

        if (videoRef.current) {

          videoRef.current.srcObject = stream

          await videoRef.current.play()

        }

      } catch (failure) {

        setCameraError(failure instanceof Error ? failure.message : 'Unable to access the camera. Check browser permissions.')

      }

    }

    void startCamera()

    return () => {

      active = false

      cameraStreamRef.current?.getTracks().forEach((track) => track.stop())

      cameraStreamRef.current = null

    }

  }, [cameraOpen])

  const closeCamera = () => {

    cameraStreamRef.current?.getTracks().forEach((track) => track.stop())

    cameraStreamRef.current = null

    setCameraOpen(false)

  }

  const captureCameraPhoto = () => {

    const video = videoRef.current

    if (!video || !video.videoWidth || !video.videoHeight) {

      setCameraError('Camera is not ready yet. Please wait a moment.')

      return

    }

    const canvas = document.createElement('canvas')

    const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight))

    canvas.width = Math.round(video.videoWidth * scale)

    canvas.height = Math.round(video.videoHeight * scale)

    const context = canvas.getContext('2d')

    if (!context) {

      setCameraError('Could not capture the photo. Please try again.')

      return

    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height)

    canvas.toBlob((blob) => {

      if (!blob) {

        setCameraError('Could not create the photo. Please try again.')

        return

      }

      const file = new File([blob], `production-${Date.now()}.jpg`, { type: 'image/jpeg' })

      if (photoPreview) URL.revokeObjectURL(photoPreview)

      setSelectedPhoto(file)

      setPhotoPreview(URL.createObjectURL(file))

      setError('')

      setSuccess('')

      closeCamera()

    }, 'image/jpeg', 0.82)

  }

  const handlePhotoChange = (event: React.ChangeEvent<HTMLInputElement>) => {

    const file = event.target.files?.[0]

    setError('')

    setSuccess('')

    setPhotoPreview('')

    if (!file) {

      setSelectedPhoto(null)

      return

    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp']

    if (!allowedTypes.includes(file.type)) {

      setSelectedPhoto(null)

      event.target.value = ''

      setError('Choose a JPG, PNG or WebP image.')

      return

    }

    if (file.size > 5 * 1024 * 1024) {

      setSelectedPhoto(null)

      event.target.value = ''

      setError('The photo must be 5 MB or smaller.')

      return

    }

    setSelectedPhoto(file)

    setPhotoPreview(URL.createObjectURL(file))

  }

  const removeSelectedPhoto = () => {

    if (photoPreview) URL.revokeObjectURL(photoPreview)

    setSelectedPhoto(null)

    setPhotoPreview('')

    const cameraInput = document.getElementById('production-camera') as HTMLInputElement | null

    const galleryInput = document.getElementById('production-gallery') as HTMLInputElement | null

    if (cameraInput) cameraInput.value = ''

    if (galleryInput) galleryInput.value = ''

  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {

    event.preventDefault()

    setSuccess('')

    setError('')

    const dailyQuantity = Number(quantity)

    if (!selectedOrderId) {

      setError('Please select an order.')

      return

    }

    if (!Number.isInteger(dailyQuantity) || dailyQuantity <= 0) {

      setError('Enter a valid quantity greater than zero.')

      return

    }

    setSubmitting(true)

    try {
      if (!currentUserId) {
        throw new Error('Your supervisor account could not be identified. Please sign in again.')
      }

      const queuedItem: OfflineProductionSubmission = {
        clientRequestId: crypto.randomUUID(),
        userId: currentUserId,
        orderId: selectedOrderId,
        stage,
        quantity: dailyQuantity,
        issueNote: issueNote.trim(),
        photoBlob: selectedPhoto ?? undefined,
        photoName: selectedPhoto?.name,
        photoType: selectedPhoto?.type,
        createdAt: new Date().toISOString(),
        status: 'QUEUED',
      }

      // Persist before attempting any network request. This keeps the report
      // safe if the connection drops during upload or submission.
      await saveOfflineSubmission(queuedItem)
      await refreshOfflineQueue()

      setQuantity('')
      setIssueNote('')
      if (photoPreview) URL.revokeObjectURL(photoPreview)
      setSelectedPhoto(null)
      setPhotoPreview('')
      const cameraInput = document.getElementById('production-camera') as HTMLInputElement | null
      const galleryInput = document.getElementById('production-gallery') as HTMLInputElement | null
      if (cameraInput) cameraInput.value = ''
      if (galleryInput) galleryInput.value = ''

      if (!navigator.onLine) {
        setSuccess('Saved securely on this device. It will sync automatically when the connection returns.')
      } else {
        const synced = await syncQueuedSubmissions()
        if (synced > 0) {
          setSuccess(
            queuedItem.issueNote
              ? 'Production update synced. AI classification was attempted; check the AI Review queue for its result.'
              : 'Production update synced successfully.',
          )
        } else {
          setSuccess('Production update is saved on this device and waiting to sync.')
        }
      }

      setHistoryLoading(true)
      setHistoryError('')
      await Promise.all([refreshOrders(), loadHistory()])

    } catch (err: unknown) {
      const message = err instanceof Error
        ? err.message
        : 'Unable to save the production update on this device.'
      setError(message)

    } finally {

      setSubmitting(false)

    }

  }

  return (

    <div className="page-content supervisor-workspace">

      <section className="page-heading">

        <div>

          <div className="eyebrow">UNIT PRODUCTION</div>

          <h1>

            Daily <span>update.</span>

          </h1>

          <p className="page-description">

            Record today's production progress and report issues

            from your unit.

          </p>

        </div>

      </section>

      {(!isOnline || offlineQueue.length > 0) && (
        <section className="supervisor-offline-card" aria-live="polite">
          <div className="supervisor-offline-topline">
            <div>
              <span className={`supervisor-offline-indicator ${isOnline ? 'is-online' : 'is-offline'}`} />
              <strong>{isOnline ? 'Connection restored' : 'Offline mode'}</strong>
            </div>
            <span className="supervisor-offline-count">
              {offlineQueue.length} pending {offlineQueue.length === 1 ? 'report' : 'reports'}
            </span>
          </div>
          <p>
            {isOnline
              ? 'Your saved reports will sync to StitchFlow. Keep this page open until syncing finishes.'
              : 'Reports are being saved on this device, including selected photos. They will upload when you reconnect.'}
          </p>
          {offlineQueue.map((item) => (
            <div className="supervisor-offline-item" key={item.clientRequestId}>
              <span>{orders.find((order) => order.id === item.orderId)?.po ?? 'Production order'} · {item.stage.replace(/_/g, ' ')}</span>
              <span>{item.status === 'SYNCING' ? 'Syncing…' : item.status === 'FAILED' ? 'Needs retry' : 'Queued'}</span>
              {item.lastError && <small>{item.lastError}</small>}
            </div>
          ))}
          <button
            type="button"
            className="secondary-button"
            onClick={() => void syncQueuedSubmissions()}
            disabled={!isOnline || isSyncingQueue || offlineQueue.length === 0}
          >
            {isSyncingQueue ? 'Syncing reports…' : 'Sync pending reports'}
          </button>
        </section>
      )}

      <section className="supervisor-order-card">

        <div className="eyebrow">YOUR ASSIGNED ORDERS</div>

        {ordersLoading ? (

          <p>Loading your assigned orders...</p>

        ) : orders.length === 0 ? (

          <p>No orders are currently assigned to your unit.</p>

        ) : (

          <>

            <label htmlFor="supervisor-order">Select order</label>

            <select

              id="supervisor-order"

              value={selectedOrderId}

              onChange={(event) => setSelectedOrderId(event.target.value)}

            >

              {orders.map((order) => (

                <option key={order.id} value={order.id}>

                  {order.po} — {order.style}

                </option>

              ))}

            </select>

            {selectedOrder && (

              <div className="supervisor-order-details">

                <div>

                  <span>Buyer</span>

                  <strong>{selectedOrder.buyer}</strong>

                </div>

                <div>

                  <span>Production unit</span>

                  <strong>{selectedOrder.unit}</strong>

                </div>

                <div>

                  <span>Current progress</span>

                  <strong>

                    {formatNumber(selectedOrder.completed)} /{' '}

                    {formatNumber(selectedOrder.quantity)} pieces

                  </strong>

                </div>

                <div>

                  <span>Ex-factory date</span>

                  <strong>{selectedOrder.shipDate}</strong>

                </div>

              </div>

            )}

          </>

        )}

      </section>

      <section className="supervisor-form-card">

        <div className="eyebrow">DAILY PRODUCTION REPORT</div>

        <h2>Submit today's output</h2>

        <p className="muted-text">

          Enter the quantity completed at the selected production stage.

        </p>

        <form onSubmit={handleSubmit}>

          <label htmlFor="production-stage">Production stage</label>

          <select

            id="production-stage"

            value={stage}

            onChange={(event) => setStage(event.target.value)}

            required

          >

            <option value="CUTTING">Cutting</option>

            <option value="STITCHING">Stitching</option>

            <option value="PRINTING">Printing</option>

            <option value="WASHING">Washing</option>

            <option value="FINISHING">Finishing</option>

            <option value="PACKING">Packing</option>

          </select>

          <label htmlFor="daily-quantity">

            Quantity completed today

          </label>

          <input

            id="daily-quantity"

            type="number"

            min="1"

            step="1"

            value={quantity}

            onChange={(event) => setQuantity(event.target.value)}

            placeholder="Enter number of pieces"

            required

          />

          <label htmlFor="production-note">

            Issue note <span>(Optional)</span>

          </label>

          <textarea

            id="production-note"

            value={issueNote}

            onChange={(event) => setIssueNote(event.target.value)}

            placeholder="Describe production issues here. Tamil notes are also supported."

            rows={4}

          />

          <label>Production photo (Optional)</label>

          <input

            id="production-gallery"

            type="file"

            accept="image/jpeg,image/png,image/webp"

            onChange={handlePhotoChange}

            style={{ display: 'none' }}

          />

          <div className="production-photo-picker">

            <button type="button" className="photo-picker-option photo-camera-option" onClick={() => { setCameraError(''); setCameraOpen(true) }}>

              <Camera size={19} />

              <span>Take photo</span>

            </button>

            <button

              type="button"

              className="photo-picker-option"

              onClick={() => {

                if (cameraOpen) closeCamera()

                document.getElementById('production-gallery')?.click()

              }}

            >

              <ImageIcon size={19} />

              <span>Choose from gallery</span>

            </button>

          </div>

          <p className="muted-text photo-help-text">JPG, PNG or WebP · Maximum 5 MB</p>

          {photoPreview && (

            <div className="production-photo-preview">

              <img src={photoPreview} alt="Selected production" />

              <div className="production-photo-preview-info">

                <span>Photo ready to upload</span>

                <button type="button" className="text-button" onClick={removeSelectedPhoto}>Remove</button>

              </div>

            </div>

          )}

          {cameraOpen && (

            <div className="camera-modal-backdrop" role="presentation">

              <section className="camera-modal" role="dialog" aria-modal="true" aria-labelledby="camera-title">

                <div className="camera-modal-heading">

                  <div><div className="eyebrow">PRODUCTION EVIDENCE</div><h3 id="camera-title">Take a photo</h3></div>

                  <button type="button" className="icon-button" onClick={closeCamera} aria-label="Close camera"><X size={20} /></button>

                </div>

                <video ref={videoRef} className="camera-live-preview" autoPlay playsInline muted />

                {cameraError && <p className="supervisor-error" role="alert">{cameraError}</p>}

                <div className="camera-modal-actions">

                  <button type="button" className="secondary-button" onClick={closeCamera}>Cancel</button>

                  <button type="button" className="primary-button" onClick={captureCameraPhoto}><Camera size={17} /> Capture photo</button>

                </div>

              </section>

            </div>

          )}

          {success && (

            <div className="supervisor-success" role="status">

              <CheckCircle2 size={18} />

              {success}

            </div>

          )}

          {error && (

            <div className="supervisor-error" role="alert">

              {error}

            </div>

          )}

          <button

            className="primary-button supervisor-submit"

            type="submit"

            disabled={submitting || ordersLoading || orders.length === 0}

          >

            {submitting ? 'Submitting...' : 'Submit production update'}

          </button>

        </form>

      </section>

      <section className="supervisor-history-card">

        <div className="supervisor-history-heading">

          <div>

            <div className="eyebrow">PRODUCTION ACTIVITY</div>

            <h2>Recent production updates</h2>

            <p className="muted-text">

              Latest daily reports submitted by your production unit.

            </p>

          </div>

          <button

            type="button"

            className="text-button supervisor-history-refresh"

            onClick={() => {
              setHistoryLoading(true)
              setHistoryError('')
              void loadHistory()
            }}

            disabled={historyLoading}

          >

            {historyLoading ? 'Refreshing...' : 'Refresh history'}

          </button>

        </div>

        {historyError && (

          <div className="supervisor-error" role="alert">

            {historyError}

          </div>

        )}

        {historyLoading ? (

          <p className="muted-text">Loading production history...</p>

        ) : history.length === 0 ? (

          <div className="supervisor-history-empty">

            No production updates have been submitted yet.

          </div>

        ) : (

          <div className="supervisor-history-list">

            {history.map((item) => {

              const createdAt = new Date(item.createdAt)

              const submittedAt = Number.isNaN(createdAt.getTime())

                ? '—'

                : createdAt.toLocaleString('en-IN', {

                    day: '2-digit',

                    month: 'short',

                    year: 'numeric',

                    hour: '2-digit',

                    minute: '2-digit',

                  })

              return (

                <article className="supervisor-history-item" key={item.id}>

                  <div className="supervisor-history-item-top">

                    <div>

                      <strong>{item.order?.poNumber ?? 'Order'}</strong>

                      <span className="supervisor-history-stage">

                        {item.stage.replace(/_/g, ' ')}

                      </span>

                    </div>

                    <strong className="supervisor-history-quantity">

                      {formatNumber(item.quantity)} pieces

                    </strong>

                  </div>

                  <div className="supervisor-history-meta">

                    <span>Submitted by {item.user?.name ?? 'Supervisor'}</span>

                    <span>{submittedAt}</span>

                  </div>

                  {item.issueNote && (

                    <p className="supervisor-history-note">{item.issueNote}</p>

                  )}

                  {item.photoUrl && (

                    <div className="supervisor-history-photo-wrap" style={{ marginTop: 10 }}>

                      <ProtectedBuyerPhoto

                        src={item.photoUrl}

                        alt={`Production evidence for ${item.order?.poNumber ?? 'order'}`}

                        className="supervisor-history-photo"

                      />

                    </div>

                  )}

                </article>

              )

            })}

          </div>

        )}

      </section>

    </div>

  )

}


type BuyerWorkspaceProps = {
  orders: Order[]
  ordersLoading: boolean
  ordersError: string
  refreshOrders: () => Promise<void>
}


function getProtectedPhotoPath(src: string): string {
  // Older uploads were stored as /uploads/<filename>. New uploads use the
  // authenticated /api/production-photos/file/<filename> endpoint. Always
  // resolve known image URLs through the protected endpoint.
  const cleanPath = src.split(/[?#]/, 1)[0];
  const filename = cleanPath.split('/').filter(Boolean).pop();

  if (!filename || !/^[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(filename)) {
    return src;
  }

  return `/production-photos/file/${encodeURIComponent(filename)}`;
}

function ProtectedBuyerPhoto({
  src,
  alt,
  className,
}: {
  src: string
  alt: string
  className?: string
}) {
  const [imageUrl, setImageUrl] = useState('');
  const [failed, setFailed] = useState(false);
  const protectedPath = getProtectedPhotoPath(src);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    setImageUrl('');
    setFailed(false);

    api.get(protectedPath, { responseType: 'blob' })
      .then((response) => {
        objectUrl = URL.createObjectURL(response.data);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setImageUrl(objectUrl);
      })
      .catch((error: unknown) => {
        console.error('Unable to load protected production photo:', error);
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [protectedPath]);

  if (failed) {
    return <div className="buyer-photo-unavailable">Photo unavailable</div>;
  }

  if (!imageUrl) {
    return <div className="buyer-photo-loading" aria-label="Loading production photo">Loading photo…</div>;
  }

  return <img className={className} src={imageUrl} alt={alt} loading="lazy" />;
}

function BuyerWorkspace({
  orders,
  ordersLoading,
  ordersError,
  refreshOrders,
}: BuyerWorkspaceProps) {
  const [auditOrderId, setAuditOrderId] = useState<string | null>(null)
  const [auditEntries, setAuditEntries] = useState<TnaAuditEntry[]>([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditError, setAuditError] = useState('')

  const loadBuyerAuditHistory = async (orderId: string) => {
    setAuditOrderId(orderId)
    setAuditEntries([])
    setAuditError('')
    setAuditLoading(true)
    try {
      const response = await api.get<{ entries: TnaAuditEntry[] }>(
        `/order-audit/orders/${encodeURIComponent(orderId)}`,
      )
      setAuditEntries(response.data.entries ?? [])
    } catch (error: unknown) {
      const message = (error as { response?: { data?: { message?: string } } }).response?.data?.message
      setAuditError(message || 'Unable to load date-change history.')
    } finally {
      setAuditLoading(false)
    }
  }

  const formatBuyerAuditDate = (value: string | null) => {
    if (!value) return '—'
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
  }

  const totalQuantity = orders.reduce((sum, order) => sum + order.quantity, 0)
  const completedQuantity = orders.reduce((sum, order) => sum + order.completed, 0)
  const completion = totalQuantity > 0
    ? Math.min(100, Math.round((completedQuantity / totalQuantity) * 100))
    : 0

  return (
    <div className="page-content buyer-workspace">
      <section className="page-heading buyer-page-heading">
        <div>
          <div className="eyebrow">BUYER PORTAL</div>
          <h1>Your orders<span>.</span></h1>
          <p className="page-description">
            Track your production milestones and view the latest shared production evidence.
          </p>
        </div>
        <button
          type="button"
          className="secondary-button buyer-refresh-button"
          onClick={() => void refreshOrders()}
          disabled={ordersLoading}
        >
          <Activity size={16} />
          {ordersLoading ? 'Refreshing...' : 'Refresh orders'}
        </button>
      </section>

      {ordersError && (
        <div className="buyer-error" role="alert">
          {ordersError}
        </div>
      )}

      <section className="buyer-summary-grid" aria-label="Order summary">
        <article className="buyer-summary-card">
          <span>YOUR ORDERS</span>
          <strong>{ordersLoading ? '—' : orders.length}</strong>
          <small>Orders linked to your company</small>
        </article>
        <article className="buyer-summary-card">
          <span>TOTAL PIECES</span>
          <strong>{ordersLoading ? '—' : formatNumber(totalQuantity)}</strong>
          <small>Across your active orders</small>
        </article>
        <article className="buyer-summary-card">
          <span>PRODUCTION RECORDED</span>
          <strong>{ordersLoading ? '—' : `${completion}%`}</strong>
          <small>{formatNumber(completedQuantity)} pieces marked complete</small>
        </article>
      </section>

      <section className="buyer-orders-section">
        <div className="buyer-section-heading">
          <div>
            <div className="eyebrow">PRODUCTION TRACKING</div>
            <h2>Order progress</h2>
            <p>Milestones and evidence shared by your production team.</p>
          </div>
          <span className="buyer-readonly-label">READ ONLY</span>
        </div>

        {ordersLoading ? (
          <div className="buyer-empty-state">
            <Activity size={22} />
            <strong>Loading your orders...</strong>
            <span>Fetching the latest order and milestone information.</span>
          </div>
        ) : orders.length === 0 ? (
          <div className="buyer-empty-state">
            <Package size={24} />
            <strong>No orders are available yet</strong>
            <span>Orders assigned to your buyer account will appear here.</span>
          </div>
        ) : (
          <div className="buyer-order-list">
            {orders.map((order) => {
              const progress = order.quantity > 0
                ? Math.min(100, Math.round((order.completed / order.quantity) * 100))
                : 0
              const sortedMilestones = [...order.milestones].sort(
                (a, b) => new Date(a.plannedDate).getTime() - new Date(b.plannedDate).getTime(),
              )
              const photoUpdates = order.updates
                .filter((update) => Boolean(update.photoUrl))
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                .slice(0, 8)

              return (
                <article className="buyer-order-card" key={order.id}>
                  <div className="buyer-order-card-header">
                    <div>
                      <div className="buyer-order-kicker">PURCHASE ORDER</div>
                      <h3>{order.po}</h3>
                      <p>{order.buyer} · {order.country}</p>
                    </div>
                    <div className="buyer-exfactory">
                      <span>EX-FACTORY</span>
                      <strong>{order.shipDate}</strong>
                    </div>
                  </div>

                  <div className="buyer-product-row">
                    <div>
                      <span>STYLE</span>
                      <strong>{order.style}</strong>
                    </div>
                    <div>
                      <span>COLOUR</span>
                      <strong>{order.colour}</strong>
                    </div>
                    <div>
                      <span>ORDER QUANTITY</span>
                      <strong>{formatNumber(order.quantity)} pieces</strong>
                    </div>
                  </div>

                  <div className="buyer-progress-block">
                    <div className="buyer-progress-heading">
                      <span>Production progress</span>
                      <strong>{progress}%</strong>
                    </div>
                    <div className="buyer-progress-track">
                      <div style={{ width: `${progress}%` }} />
                    </div>
                    <p>{formatNumber(order.completed)} of {formatNumber(order.quantity)} pieces marked complete</p>
                  </div>

                  <div className="buyer-milestone-section">
                    <div className="buyer-subheading">
                      <h4>Time and action plan</h4>
                      <span>{sortedMilestones.length} milestones</span>
                    </div>
                    {sortedMilestones.length === 0 ? (
                      <p className="buyer-muted">No milestones have been added to this order yet.</p>
                    ) : (
                      <div className="buyer-milestone-list">
                        {sortedMilestones.map((milestone, index) => {
                          const statusClass = milestone.status.toLowerCase().replace('_', '-')
                          return (
                            <div className="buyer-milestone-row" key={milestone.id}>
                              <div className={`buyer-milestone-index ${statusClass}`}>
                                {String(index + 1).padStart(2, '0')}
                              </div>
                              <div className="buyer-milestone-name">
                                <strong>{milestone.stage.replace(/_/g, ' ')}</strong>
                                <span>{milestone.actualDate ? `Completed ${formatDate(milestone.actualDate)}` : `Planned ${formatDate(milestone.plannedDate)}`}</span>
                              </div>
                              <span className={`buyer-milestone-status ${statusClass}`}>
                                {milestone.status.replace(/_/g, ' ')}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  <div className="buyer-date-audit-access">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void loadBuyerAuditHistory(order.id)}
                    >
                      View date-change history
                    </button>
                  </div>

                  {auditOrderId === order.id && (
                    <section className="buyer-audit-panel" aria-label={`Date-change history for ${order.po}`}>
                      <div className="buyer-subheading">
                        <h4>Date-change history</h4>
                        <button type="button" className="secondary-button" onClick={() => { setAuditOrderId(null); setAuditEntries([]); setAuditError('') }}>Close</button>
                      </div>
                      {auditLoading ? (
                        <p className="buyer-muted">Loading audit history…</p>
                      ) : auditError ? (
                        <p className="buyer-error" role="alert">{auditError}</p>
                      ) : auditEntries.length === 0 ? (
                        <p className="buyer-muted">No date changes have been recorded for this order.</p>
                      ) : (
                        <div className="buyer-audit-list">
                          {auditEntries.map((entry) => (
                            <article className="buyer-audit-entry" key={entry.id}>
                              <strong>{entry.fieldName.replace(/:/g, ' · ').replace(/plannedDate/i, 'planned date').replace(/exFactoryDate/i, 'ex-factory date')}</strong>
                              <div className="buyer-audit-dates">
                                <span>{formatBuyerAuditDate(entry.oldValue)}</span>
                                <b>→</b>
                                <span>{formatBuyerAuditDate(entry.newValue)}</span>
                              </div>
                              <small>Changed by {entry.changedByName} · {formatBuyerAuditDate(entry.changedAt)}</small>
                            </article>
                          ))}
                        </div>
                      )}
                    </section>
                  )}

                  <div className="buyer-photo-section">
                    <div className="buyer-subheading">
                      <h4>Production photos</h4>
                      <span>{photoUpdates.length} shared</span>
                    </div>
                    {photoUpdates.length === 0 ? (
                      <p className="buyer-muted">No production photos have been shared for this order yet.</p>
                    ) : (
                      <div className="buyer-photo-grid">
                        {photoUpdates.map((update) => (
                          <div
                            key={update.id}
                            className="buyer-photo-item"
                            aria-label={`${update.stage.replace(/_/g, ' ')} production photo`}
                          >
                            {update.photoUrl && (
                              <ProtectedBuyerPhoto
                                src={update.photoUrl}
                                alt={`${update.stage.replace(/_/g, ' ')} production evidence`}
                              />
                            )}
                            <span>{update.stage.replace(/_/g, ' ')}</span>
                            <small>{formatDate(update.createdAt)}</small>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

type OrderSetupBuyer = {
  id: string
  companyName: string
  country?: string | null
}

type OrderSetupTemplateItem = {
  stage: string
  daysBeforeExFactory: number
}

type OrderSetupOptions = {
  success: boolean
  buyers: OrderSetupBuyer[]
  units: string[]
  stages: string[]
  defaultTnaTemplate: OrderSetupTemplateItem[]
}

type DraftMilestone = {
  stage: string
  plannedDate: string
}

function formatDateForInput(date: Date) {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateBeforeExFactory(exFactoryDate: string, daysBefore: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(exFactoryDate)) return ''

  const [year, month, day] = exFactoryDate.split('-').map(Number)

  // setUTCFullYear avoids the Date.UTC special case that turns years 00–99
  // into 1900–1999 (for example, year 0005 becoming 1905).
  const date = new Date(0)
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCDate(date.getUTCDate() - daysBefore)

  const resultYear = String(date.getUTCFullYear()).padStart(4, '0')
  const resultMonth = String(date.getUTCMonth() + 1).padStart(2, '0')
  const resultDay = String(date.getUTCDate()).padStart(2, '0')
  return `${resultYear}-${resultMonth}-${resultDay}`
}

function OrderSetupWorkspace({
  onCancel,
  refreshOrders,
}: {
  onCancel: () => void
  refreshOrders: () => Promise<void>
}) {
  const [setupOptions, setSetupOptions] = useState<OrderSetupOptions | null>(null)
  const [optionsLoading, setOptionsLoading] = useState(true)
  const [optionsError, setOptionsError] = useState('')

  const [poNumber, setPoNumber] = useState('')
  const [buyerId, setBuyerId] = useState('')
  const [styleName, setStyleName] = useState('')
  const [colour, setColour] = useState('')
  const [sizeQuantities, setSizeQuantities] = useState<Record<string, string>>({ XS: '', S: '', M: '', L: '', XL: '', XXL: '' })
  const [unitName, setUnitName] = useState('')
  const [exFactoryDate, setExFactoryDate] = useState('')
  const [milestones, setMilestones] = useState<DraftMilestone[]>([])
  const todayDate = formatDateForInput(new Date())
  const totalQuantity = Object.values(sizeQuantities).reduce((sum, value) => sum + (value.trim() ? Math.max(0, Number(value) || 0) : 0), 0)

  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  useEffect(() => {
    let cancelled = false

    api.get<OrderSetupOptions>('/orders/setup-options')
      .then((response) => {
        if (cancelled) return
        const options = response.data
        setSetupOptions(options)
        setBuyerId(options.buyers[0]?.id ?? '')
        setUnitName(options.units[0] ?? '')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const message = (
          error as { response?: { data?: { message?: string } } }
        ).response?.data?.message
        setOptionsError(message || 'Unable to load buyers and TNA options.')
      })
      .finally(() => {
        if (!cancelled) setOptionsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const handleExFactoryChange = (value: string) => {
    if (value && value < todayDate) {
      setFormError('Choose today or a future ex-factory date.')
      return
    }

    setFormError('')
    setExFactoryDate(value)
    setSuccessMessage('')
    if (!setupOptions || !value) {
      setMilestones([])
      return
    }
    setMilestones(
      setupOptions.defaultTnaTemplate.map((item) => ({
        stage: item.stage,
        plannedDate: dateBeforeExFactory(value, item.daysBeforeExFactory),
      })),
    )
  }

  const handleMilestoneDateChange = (index: number, value: string) => {
    setMilestones((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, plannedDate: value } : item,
      ),
    )
    setSuccessMessage('')
  }

  const handleCreateOrder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError('')
    setSuccessMessage('')

    const quantity = totalQuantity
    if (!poNumber.trim() || !buyerId || !styleName.trim() || !colour.trim() || !unitName || !exFactoryDate) {
      setFormError('Complete all required order details before continuing.')
      return
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setFormError('Enter a positive whole-number quantity for at least one size.')
      return
    }
    if (milestones.length === 0 || milestones.some((item) => !item.plannedDate)) {
      setFormError('Choose an ex-factory date to generate all TNA milestone dates.')
      return
    }

    const milestoneTimes = milestones.map((item) =>
      new Date(`${item.plannedDate}T00:00:00.000Z`).getTime(),
    )
    const exFactoryTime = new Date(`${exFactoryDate}T00:00:00.000Z`).getTime()

    if (milestoneTimes.some((value, index) =>
      value > exFactoryTime || (index > 0 && value < milestoneTimes[index - 1]),
    )) {
      setFormError('TNA dates must be chronological and cannot be after the ex-factory date.')
      return
    }

    setSubmitting(true)
    try {
      const payload = {
        poNumber: poNumber.trim(),
        buyerId,
        styleName: styleName.trim(),
        colour: colour.trim(),
        totalQuantity: quantity,
        sizeQuantities: Object.fromEntries(
          Object.entries(sizeQuantities)
            .filter(([, value]) => Number(value) > 0)
            .map(([size, value]) => [size, Number(value)]),
        ),
        unitName,
        exFactoryDate: `${exFactoryDate}T00:00:00.000Z`,
        milestones: milestones.map((item) => ({
          stage: item.stage,
          plannedDate: `${item.plannedDate}T00:00:00.000Z`,
        })),
      }

      const response = await api.post<{
        success: boolean
        message: string
        order: { poNumber: string }
      }>('/orders', payload)

      setSuccessMessage(`Order ${response.data.order.poNumber} created with ${milestones.length} TNA milestones.`)
      resetFormAfterSuccess()
      await refreshOrders()
    } catch (error: unknown) {
      const responseData = (
        error as {
          response?: {
            status?: number
            data?: {
              message?: string
              debug?: string
              errors?: {
                formErrors?: string[]
                fieldErrors?: Record<string, string[]>
              }
            }
          }
        }
      ).response?.data

      const message = responseData?.message
      const debug = responseData?.debug
      const fieldErrors = responseData?.errors?.fieldErrors
      const firstFieldError = fieldErrors
        ? Object.entries(fieldErrors).flatMap(([field, messages]) =>
            messages.map((item) => `${field}: ${item}`),
          )[0]
        : undefined

      const visibleMessage = firstFieldError || message ||
        'Unable to create order. Check the details and try again.'

      setFormError(debug ? `${visibleMessage} (${debug})` : visibleMessage)
    } finally {
      setSubmitting(false)
    }
  }

  const resetFormAfterSuccess = () => {
    setPoNumber('')
    setStyleName('')
    setColour('')
    setSizeQuantities({ XS: '', S: '', M: '', L: '', XL: '', XXL: '' })
    setExFactoryDate('')
    setMilestones([])
  }

  return (
    <div className="page-content order-setup-workspace">
      <section className="page-heading order-setup-page-heading">
        <div>
          <div className="eyebrow">ORDER MANAGEMENT</div>
          <h1>Create <span>order.</span></h1>
          <p className="page-description">
            Set up a production order and generate its time-and-action milestones.
          </p>
        </div>
        <button type="button" className="secondary-button order-setup-back" onClick={onCancel}>
          <ArrowUpRight size={16} /> Back to orders
        </button>
      </section>

      {optionsLoading && (
        <section className="order-setup-card order-setup-loading">
          <Activity size={20} /> Loading buyer and TNA setup options...
        </section>
      )}

      {optionsError && (
        <div className="supervisor-error" role="alert">
          {optionsError}
          <button type="button" className="text-button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      )}

      {!optionsLoading && setupOptions && (
        <form className="order-setup-card" onSubmit={handleCreateOrder}>
          <div className="order-setup-section-heading">
            <div>
              <div className="eyebrow">01 / ORDER DETAILS</div>
              <h2>Production information</h2>
              <p>Enter the buyer, product, quantity and shipment details.</p>
            </div>
            <span className="order-setup-required">* Required fields</span>
          </div>

          <div className="order-setup-grid">
            <div className="order-setup-field">
              <label htmlFor="setup-po">Purchase order number *</label>
              <input id="setup-po" value={poNumber} onChange={(event) => setPoNumber(event.target.value)} placeholder="e.g. B-PO-88251" required maxLength={50} />
            </div>
            <div className="order-setup-field">
              <label htmlFor="setup-buyer">Buyer *</label>
              <select id="setup-buyer" value={buyerId} onChange={(event) => setBuyerId(event.target.value)} required>
                <option value="">Select buyer</option>
                {setupOptions.buyers.map((buyer) => (
                  <option key={buyer.id} value={buyer.id}>
                    {buyer.companyName}{buyer.country ? ` — ${buyer.country}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="order-setup-field">
              <label htmlFor="setup-style">Style name *</label>
              <input id="setup-style" value={styleName} onChange={(event) => setStyleName(event.target.value)} placeholder="e.g. Men's Polo" required maxLength={120} />
            </div>
            <div className="order-setup-field">
              <label htmlFor="setup-colour">Colour *</label>
              <input id="setup-colour" value={colour} onChange={(event) => setColour(event.target.value)} placeholder="e.g. Black" required maxLength={50} />
            </div>
            <div className="order-setup-size-field">
              <div className="order-setup-size-heading">
                <label>Size-wise quantity *</label>
                <strong>{formatNumber(totalQuantity)} pieces total</strong>
              </div>
              <div className="order-setup-size-grid">
                {['XS', 'S', 'M', 'L', 'XL', 'XXL'].map((size) => (
                  <label className="order-setup-size-cell" key={size} htmlFor={`setup-size-${size}`}>
                    <span>{size}</span>
                    <input
                      id={`setup-size-${size}`}
                      type="number"
                      min="0"
                      step="1"
                      value={sizeQuantities[size]}
                      onChange={(event) => {
                        const value = event.target.value
                        setSizeQuantities((current) => ({ ...current, [size]: value }))
                        setSuccessMessage('')
                      }}
                      placeholder="0"
                    />
                  </label>
                ))}
              </div>
              <span className="order-setup-size-help">Enter pieces for each available size. Leave a size at zero when it is not included.</span>
            </div>
            <div className="order-setup-field">
              <label htmlFor="setup-unit">Production unit *</label>
              <select id="setup-unit" value={unitName} onChange={(event) => setUnitName(event.target.value)} required>
                <option value="">Select unit</option>
                {setupOptions.units.map((unit) => (
                  <option key={unit} value={unit}>{unit}</option>
                ))}
              </select>
            </div>
            <div className="order-setup-field order-setup-date-field">
              <label htmlFor="setup-ex-factory">Ex-factory date *</label>
              <input
                id="setup-ex-factory"
                type="date"
                lang="en-GB"
                min={todayDate}
                max="2100-12-31"
                value={exFactoryDate}
                onChange={(event) => handleExFactoryChange(event.target.value)}
                required
              />
              <span>Changing this date regenerates the suggested TNA dates.</span>
            </div>
          </div>

          <div className="order-setup-divider" />

          <div className="order-setup-section-heading order-setup-tna-heading">
            <div>
              <div className="eyebrow">02 / TIME AND ACTION PLAN</div>
              <h2>TNA milestones</h2>
              <p>Suggested dates come from the starter template. You can adjust each date before saving.</p>
            </div>
            <span className="order-setup-count">{milestones.length} / 6 stages</span>
          </div>

          {!exFactoryDate ? (
            <div className="order-setup-empty">
              <CalendarDays size={22} />
              <strong>Select an ex-factory date first</strong>
              <span>We'll calculate suggested dates for all six production stages.</span>
            </div>
          ) : (
            <div className="order-setup-milestones">
              {milestones.map((milestone, index) => (
                <div className="order-setup-milestone" key={milestone.stage}>
                  <div className="order-setup-milestone-number">{String(index + 1).padStart(2, '0')}</div>
                  <div className="order-setup-milestone-name">
                    <strong>{milestone.stage.replace(/_/g, ' ')}</strong>
                    <span>{setupOptions.defaultTnaTemplate[index]?.daysBeforeExFactory ?? 0} days before ex-factory</span>
                  </div>
                  <div className="order-setup-milestone-date">
                    <label htmlFor={`milestone-date-${index}`}>Planned date</label>
                    <input
                      id={`milestone-date-${index}`}
                      type="date"
                      lang="en-GB"
                      min="2000-01-01"
                      max={exFactoryDate}
                      value={milestone.plannedDate}
                      onChange={(event) => handleMilestoneDateChange(index, event.target.value)}
                      required
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {successMessage && (
            <div className="supervisor-success order-setup-alert" role="status">
              <CheckCircle2 size={18} /> {successMessage}
            </div>
          )}
          {formError && (
            <div className="supervisor-error order-setup-alert" role="alert">
              {formError}
            </div>
          )}

          <div className="order-setup-actions">
            <button type="button" className="secondary-button" onClick={onCancel} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={submitting || milestones.length !== 6 || setupOptions.buyers.length === 0}>
              {submitting ? 'Creating order...' : 'Create order'}
              <ArrowUpRight size={17} />
            </button>
          </div>
        </form>
      )}
    </div>
  )
}


type IssueReasonCategory =
  | 'MACHINE_BREAKDOWN'
  | 'MATERIAL_SHORTAGE'
  | 'QUALITY_DEFECT'
  | 'LABOUR_SHORTAGE'
  | 'POWER_OR_UTILITY'
  | 'SUBCONTRACTOR_DELAY'
  | 'CAPACITY_OR_PLANNING'
  | 'OTHER'

type IssueReviewQueueItem = {
  id: string
  issueNote: string | null
  stage: string
  createdAt: string
  user: { name: string }
  order: {
    id: string
    poNumber: string
    unitName: string
    buyer: { companyName: string }
  }
  reasonAnalysis: {
    id: string
    translation: string | null
    englishSummary: string | null
    suggestedCategory: IssueReasonCategory | null
    confidence: number | null
    rationale: string | null
    providerModel: string | null
    processingStatus: string
    reviewStatus: string
    finalCategory: IssueReasonCategory | null
  }
}

type IssueReviewQueueResponse = {
  success: boolean
  count: number
  items: IssueReviewQueueItem[]
}

const issueReasonCategories: { value: IssueReasonCategory; label: string }[] = [
  { value: 'MACHINE_BREAKDOWN', label: 'Machine breakdown' },
  { value: 'MATERIAL_SHORTAGE', label: 'Material shortage' },
  { value: 'QUALITY_DEFECT', label: 'Quality defect' },
  { value: 'LABOUR_SHORTAGE', label: 'Labour shortage' },
  { value: 'POWER_OR_UTILITY', label: 'Power or utility issue' },
  { value: 'SUBCONTRACTOR_DELAY', label: 'Subcontractor delay' },
  { value: 'CAPACITY_OR_PLANNING', label: 'Capacity or planning' },
  { value: 'OTHER', label: 'Other / unclear' },
]

function formatIssueCategory(value: string | null | undefined) {
  if (!value) return 'Not classified'
  return issueReasonCategories.find((item) => item.value === value)?.label ?? value
}

function IssueReviewWorkspace() {
  const [items, setItems] = useState<IssueReviewQueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [correctedCategories, setCorrectedCategories] = useState<Record<string, IssueReasonCategory>>({})
  const [workingId, setWorkingId] = useState('')

  const loadQueue = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const response = await api.get<IssueReviewQueueResponse>('/issue-reasons/review-queue')
      setItems(response.data.items ?? [])
    } catch (error: unknown) {
      const message = (
        error as { response?: { data?: { message?: string } } }
      ).response?.data?.message
      setLoadError(message || 'Unable to load the AI review queue.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadQueue()
  }, [loadQueue])

  const handleReview = async (
    item: IssueReviewQueueItem,
    decision: 'CONFIRM' | 'CORRECT',
  ) => {
    setWorkingId(item.id)
    setActionError('')
    setSuccessMessage('')

    const correctedCategory = correctedCategories[item.id]
    if (decision === 'CORRECT' && !correctedCategory) {
      setActionError('Choose the correct category before saving your correction.')
      setWorkingId('')
      return
    }

    try {
      const body = decision === 'CONFIRM'
        ? { decision: 'CONFIRM' as const }
        : { decision: 'CORRECT' as const, correctedCategory }

      const response = await api.patch<{ message: string }>(
        `/issue-reasons/review/${encodeURIComponent(item.reasonAnalysis.id)}`,
        body,
      )
      setSuccessMessage(response.data.message || 'Review saved successfully.')
      await loadQueue()
    } catch (error: unknown) {
      const message = (
        error as { response?: { data?: { message?: string } } }
      ).response?.data?.message
      setActionError(message || 'Unable to save this review decision.')
    } finally {
      setWorkingId('')
    }
  }

  const handleRetry = async (item: IssueReviewQueueItem) => {
    setWorkingId(item.id)
    setActionError('')
    setSuccessMessage('')
    try {
      const response = await api.post<{ message?: string }>(
        `/issue-reasons/classify/${encodeURIComponent(item.id)}`,
      )
      setSuccessMessage(response.data.message || 'Issue reclassified successfully.')
      await loadQueue()
    } catch (error: unknown) {
      const message = (
        error as { response?: { data?: { message?: string } } }
      ).response?.data?.message
      setActionError(message || 'AI classification could not be retried.')
      await loadQueue()
    } finally {
      setWorkingId('')
    }
  }

  const pendingCount = items.filter(
    (item) => item.reasonAnalysis.reviewStatus === 'PENDING_REVIEW',
  ).length
  const failedCount = items.filter(
    (item) => item.reasonAnalysis.processingStatus === 'FAILED',
  ).length

  return (
    <div className="page-content issue-review-workspace">
      <section className="page-heading issue-review-heading">
        <div>
          <div className="eyebrow">MERCHANDISER CONTROL</div>
          <h1>AI issue review<span>.</span></h1>
          <p className="page-description">
            Check the original floor note, review the AI interpretation, and approve or correct its category.
          </p>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={() => void loadQueue()}
          disabled={loading}
        >
          <Activity size={16} />
          {loading ? 'Refreshing…' : 'Refresh queue'}
        </button>
      </section>

      <section className="issue-review-summary" aria-label="Review queue summary">
        <article>
          <span>ISSUES IN QUEUE</span>
          <strong>{loading ? '—' : items.length}</strong>
        </article>
        <article>
          <span>PENDING REVIEW</span>
          <strong>{loading ? '—' : pendingCount}</strong>
        </article>
        <article>
          <span>AI NEEDS RETRY</span>
          <strong>{loading ? '—' : failedCount}</strong>
        </article>
      </section>

      {loadError && <div className="issue-review-alert issue-review-alert-error" role="alert">{loadError}</div>}
      {actionError && <div className="issue-review-alert issue-review-alert-error" role="alert">{actionError}</div>}
      {successMessage && <div className="issue-review-alert issue-review-alert-success" role="status">{successMessage}</div>}

      {loading ? (
        <div className="issue-review-empty">
          <Activity size={24} />
          <strong>Loading issue reviews…</strong>
          <span>Retrieving AI classifications from the production database.</span>
        </div>
      ) : items.length === 0 ? (
        <div className="issue-review-empty">
          <CheckCircle2 size={26} />
          <strong>No classified issues waiting in the queue.</strong>
          <span>When a supervisor or merchandiser classifies a production note, it will appear here.</span>
        </div>
      ) : (
        <div className="issue-review-list">
          {items.map((item) => {
            const analysis = item.reasonAnalysis
            const isReviewed = analysis.reviewStatus === 'CONFIRMED' || analysis.reviewStatus === 'CORRECTED'
            const isFailed = analysis.processingStatus === 'FAILED'
            const isWorking = workingId === item.id
            const confidence = typeof analysis.confidence === 'number'
              ? `${Math.round(analysis.confidence * 100)}%`
              : 'Not available'

            return (
              <article className="issue-review-card" key={item.id}>
                <div className="issue-review-card-top">
                  <div>
                    <div className="issue-review-card-eyebrow">{item.order.poNumber} · {item.stage}</div>
                    <h2>{item.order.buyer.companyName}</h2>
                    <p>{item.order.unitName} · Reported by {item.user.name} · {formatDate(item.createdAt)}</p>
                  </div>
                  <span className={`issue-review-status ${isReviewed ? 'is-reviewed' : isFailed ? 'is-failed' : 'is-pending'}`}>
                    {isReviewed ? analysis.reviewStatus : isFailed ? 'AI needs retry' : 'Pending review'}
                  </span>
                </div>

                <div className="issue-review-note-grid">
                  <section className="issue-review-note original-note">
                    <span>ORIGINAL FLOOR NOTE</span>
                    <p lang="ta">{item.issueNote || 'No original note was retained.'}</p>
                  </section>
                  <section className="issue-review-note">
                    <span>AI ENGLISH TRANSLATION</span>
                    <p>{analysis.translation || 'Translation is unavailable.'}</p>
                  </section>
                </div>

                <div className="issue-review-analysis-grid">
                  <div>
                    <span>AI SUGGESTED CATEGORY</span>
                    <strong>{formatIssueCategory(analysis.suggestedCategory)}</strong>
                  </div>
                  <div>
                    <span>CONFIDENCE</span>
                    <strong>{confidence}</strong>
                  </div>
                  <div>
                    <span>MODEL</span>
                    <strong>{analysis.providerModel || 'Not recorded'}</strong>
                  </div>
                </div>

                {analysis.englishSummary && (
                  <div className="issue-review-summary-text">
                    <span>SHORT SUMMARY</span>
                    <p>{analysis.englishSummary}</p>
                  </div>
                )}
                {analysis.rationale && (
                  <div className="issue-review-rationale">
                    <strong>AI reasoning</strong>
                    <p>{analysis.rationale}</p>
                  </div>
                )}

                {isFailed ? (
                  <div className="issue-review-actions">
                    <p>AI processing failed. The original note is preserved; retry or review it manually.</p>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => void handleRetry(item)}
                      disabled={isWorking}
                    >
                      {isWorking ? 'Retrying…' : 'Retry AI classification'}
                    </button>
                  </div>
                ) : isReviewed ? (
                  <div className="issue-review-final">
                    <span>MERCHANDISER-APPROVED CATEGORY</span>
                    <strong>{formatIssueCategory(analysis.finalCategory)}</strong>
                    <p>Reviewed. This category is recorded in the production update audit history.</p>
                  </div>
                ) : (
                  <div className="issue-review-actions">
                    <div className="issue-review-correction">
                      <label htmlFor={`correct-category-${item.id}`}>Correct the category if the AI is wrong</label>
                      <select
                        id={`correct-category-${item.id}`}
                        value={correctedCategories[item.id] ?? analysis.suggestedCategory ?? ''}
                        onChange={(event) => setCorrectedCategories((current) => ({
                          ...current,
                          [item.id]: event.target.value as IssueReasonCategory,
                        }))}
                      >
                        <option value="" disabled>Select a reason category</option>
                        {issueReasonCategories.map((category) => (
                          <option key={category.value} value={category.value}>{category.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="issue-review-buttons">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => void handleReview(item, 'CORRECT')}
                        disabled={isWorking}
                      >
                        {isWorking ? 'Saving…' : 'Save correction'}
                      </button>
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() => void handleReview(item, 'CONFIRM')}
                        disabled={isWorking || !analysis.suggestedCategory}
                      >
                        {isWorking ? 'Saving…' : 'Confirm AI category'}
                      </button>
                    </div>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}


function MerchandiserProductionWorkspace() {
  const [updates, setUpdates] = useState<ProductionUpdateHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadUpdates = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await api.get<ProductionUpdateHistoryResponse>('/production-updates/history')
      setUpdates(response.data.updates ?? [])
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } }).response?.data?.message
      setError(message || 'Unable to load production activity.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadUpdates()
  }, [loadUpdates])

  return (
    <div className="page-content merchandiser-workspace-page">
      <section className="page-heading">
        <div>
          <div className="eyebrow">FACTORY FLOOR</div>
          <h1>Production <span>activity.</span></h1>
          <p className="page-description">Daily output, issue notes and production evidence reported by your units.</p>
        </div>
        <button type="button" className="secondary-button" onClick={() => void loadUpdates()} disabled={loading}>
          <Activity size={17} /> {loading ? 'Refreshing…' : 'Refresh activity'}
        </button>
      </section>

      {error && <div className="login-error" role="alert">{error} <button type="button" onClick={() => void loadUpdates()}>Retry</button></div>}
      {loading ? (
        <div className="empty-state"><Activity size={26} /><strong>Loading production activity…</strong><span>Retrieving the latest unit reports.</span></div>
      ) : updates.length === 0 ? (
        <div className="empty-state"><Factory size={26} /><strong>No production updates yet</strong><span>Supervisor reports will appear here after submission.</span></div>
      ) : (
        <section className="merch-production-list" aria-label="Production activity history">
          {updates.map((item) => (
            <article className="supervisor-history-card merch-production-card" key={item.id}>
              <div className="supervisor-history-top">
                <div className="supervisor-history-title">
                  <strong>{item.order?.poNumber ?? 'Production order'}</strong>
                  <span className="supervisor-history-stage">{item.stage.replace(/_/g, ' ')}</span>
                </div>
                <strong className="supervisor-history-quantity">{formatNumber(item.quantity)} pieces</strong>
              </div>
              <div className="supervisor-history-meta">
                <span>Submitted by {item.user?.name ?? 'Supervisor'}</span>
                <span>{new Date(item.createdAt).toLocaleString()}</span>
                {item.order?.unitName && <span>{item.order.unitName}</span>}
              </div>
              {item.issueNote && <p className="supervisor-history-note">{item.issueNote}</p>}
              {item.photoUrl && (
                <div className="supervisor-history-photo-wrap">
                  <ProtectedBuyerPhoto src={item.photoUrl} alt={`Production evidence for ${item.order?.poNumber ?? 'order'}`} className="supervisor-history-photo" />
                </div>
              )}
            </article>
          ))}
        </section>
      )}
    </div>
  )
}

type TnaAuditEntry = {
  id: string
  fieldName: string
  oldValue: string | null
  newValue: string | null
  changedBy: string
  changedByName: string
  changedAt: string
}

function TnaCalendarWorkspace({
  orders,
  ordersLoading,
  onOpenOrder,
  refreshOrders,
}: {
  orders: Order[]
  ordersLoading: boolean
  onOpenOrder: (order: Order) => void
  refreshOrders: () => Promise<void>
}) {
  const [editingMilestoneId, setEditingMilestoneId] = useState<string | null>(null)
  const [editingDate, setEditingDate] = useState('')
  const [savingMilestoneId, setSavingMilestoneId] = useState<string | null>(null)
  const [editingShipOrderId, setEditingShipOrderId] = useState<string | null>(null)
  const [editingShipDate, setEditingShipDate] = useState('')
  const [savingShipOrderId, setSavingShipOrderId] = useState<string | null>(null)
  const [auditOrderId, setAuditOrderId] = useState<string | null>(null)
  const [auditEntries, setAuditEntries] = useState<TnaAuditEntry[]>([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditError, setAuditError] = useState('')
  const auditPanelRef = useRef<HTMLElement | null>(null)
  const [notice, setNotice] = useState('')
  const [noticeError, setNoticeError] = useState(false)

  const milestones = useMemo(() => orders.flatMap((order) =>
    order.milestones.map((milestone) => ({ ...milestone, order })),
  ).sort((a, b) => new Date(a.plannedDate).getTime() - new Date(b.plannedDate).getTime()), [orders])

  const startEditing = (milestoneId: string, plannedDate: string) => {
    setEditingMilestoneId(milestoneId)
    setEditingDate(new Date(plannedDate).toISOString().slice(0, 10))
    setNotice('')
    setNoticeError(false)
  }

  const saveMilestoneDate = async (milestoneId: string) => {
    if (!editingDate) {
      setNotice('Choose a planned date before saving.')
      setNoticeError(true)
      return
    }

    setSavingMilestoneId(milestoneId)
    setNotice('')
    setNoticeError(false)

    try {
      await api.patch(`/order-audit/milestones/${encodeURIComponent(milestoneId)}/date`, {
        plannedDate: `${editingDate}T00:00:00.000Z`,
      })
      setEditingMilestoneId(null)
      setEditingDate('')
      await refreshOrders()
      setNotice('TNA date updated. The previous and new dates were recorded in the audit history.')
      setNoticeError(false)
      if (auditOrderId) await loadAuditHistory(auditOrderId)
    } catch (error: unknown) {
      const message = (error as { response?: { data?: { message?: string } } }).response?.data?.message
      setNotice(message || 'Unable to update this milestone date.')
      setNoticeError(true)
    } finally {
      setSavingMilestoneId(null)
    }
  }

  const startEditingShipDate = (order: Order) => {
    setEditingShipOrderId(order.id)
    setEditingShipDate(new Date(order.shipDateISO).toISOString().slice(0, 10))
    setNotice('')
    setNoticeError(false)
  }

  const saveShipDate = async (orderId: string) => {
    if (!editingShipDate) {
      setNotice('Choose an ex-factory date before saving.')
      setNoticeError(true)
      return
    }

    setSavingShipOrderId(orderId)
    setNotice('')
    setNoticeError(false)
    try {
      await api.patch(`/order-audit/orders/${encodeURIComponent(orderId)}/ex-factory-date`, {
        exFactoryDate: `${editingShipDate}T00:00:00.000Z`,
      })
      setEditingShipOrderId(null)
      setEditingShipDate('')
      await refreshOrders()
      setNotice('Ex-factory date updated. The previous and new dates were recorded in the audit history.')
      setNoticeError(false)
      if (auditOrderId) await loadAuditHistory(auditOrderId)
    } catch (error: unknown) {
      const message = (error as { response?: { data?: { message?: string } } }).response?.data?.message
      setNotice(message || 'Unable to update the ex-factory date.')
      setNoticeError(true)
    } finally {
      setSavingShipOrderId(null)
    }
  }

  const loadAuditHistory = async (orderId: string) => {
    setAuditOrderId(orderId)
    setAuditLoading(true)
    setAuditError('')
    setAuditEntries([])
    try {
      const response = await api.get<{ entries: TnaAuditEntry[] }>(
        `/order-audit/orders/${encodeURIComponent(orderId)}`,
      )
      setAuditEntries(response.data.entries ?? [])
    } catch (error: unknown) {
      const message = (error as { response?: { data?: { message?: string } } }).response?.data?.message
      setAuditError(message || 'Unable to load date-change history.')
    } finally {
      setAuditLoading(false)
    }
  }

  // The audit panel is rendered after the milestone and shipment lists.
  // Bring it into view after the request finishes so History feels responsive
  // on both desktop and phone-sized screens.
  useEffect(() => {
    if (auditOrderId && !auditLoading && auditPanelRef.current) {
      auditPanelRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [auditOrderId, auditLoading])

  const auditOrder = orders.find((order) => order.id === auditOrderId)
  const formatAuditDate = (value: string | null) => {
    if (!value) return '—'
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
  }

  return (
    <div className="page-content merchandiser-workspace-page">
      <section className="page-heading">
        <div>
          <div className="eyebrow">TIME AND ACTION PLAN</div>
          <h1>TNA <span>calendar.</span></h1>
          <p className="page-description">Review planned production milestones, update dates and inspect the compliance audit trail.</p>
        </div>
        <span className="period-tag">{milestones.length} milestones</span>
      </section>

      {notice && <div className={`tna-feedback${noticeError ? ' is-error' : ''}`} role="status">{notice}</div>}

      {ordersLoading ? (
        <div className="empty-state"><Activity size={26} /><strong>Loading milestones…</strong></div>
      ) : milestones.length === 0 ? (
        <div className="empty-state"><CalendarDays size={26} /><strong>No TNA milestones found</strong><span>Create an order with a TNA template to populate this calendar.</span></div>
      ) : (
        <section className="tna-list" aria-label="TNA milestones">
          {milestones.map((milestone) => (
            <article className="tna-row" key={`${milestone.order.id}-${milestone.id}`}>
              <div className="tna-date-block">
                <strong>{new Date(milestone.plannedDate).toLocaleDateString(undefined, { day: '2-digit' })}</strong>
                <span>{new Date(milestone.plannedDate).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</span>
              </div>
              <div className="tna-main">
                <strong>{milestone.stage.replace(/_/g, ' ')}</strong>
                <span>{milestone.order.po} · {milestone.order.style} · {milestone.order.buyer}</span>
              </div>
              <span className={`tna-status tna-status-${milestone.status.toLowerCase().replace(/_/g, '-')}`}>{milestone.status.replace(/_/g, ' ')}</span>
              <div className="tna-row-actions">
                {editingMilestoneId === milestone.id ? (
                  <div className="tna-date-editor">
                    <input
                      type="date"
                      value={editingDate}
                      onChange={(event) => setEditingDate(event.target.value)}
                      aria-label={`New planned date for ${milestone.stage}`}
                    />
                    <button
                      type="button"
                      className="primary-button"
                      disabled={savingMilestoneId === milestone.id}
                      onClick={() => void saveMilestoneDate(milestone.id)}
                    >
                      {savingMilestoneId === milestone.id ? 'Saving…' : 'Save date'}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => { setEditingMilestoneId(null); setEditingDate('') }}
                    >Cancel</button>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => startEditing(milestone.id, milestone.plannedDate)}
                    >Edit date</button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void loadAuditHistory(milestone.order.id)}
                    >History</button>
                    <button
                      type="button"
                      className="secondary-button tna-view-button"
                      onClick={() => onOpenOrder(milestone.order)}
                    >View order</button>
                  </>
                )}
              </div>
            </article>
          ))}
        </section>
      )}

      <section className="tna-ship-date-section" aria-label="Ex-factory dates">
        <div className="section-heading-row">
          <div>
            <div className="eyebrow">SHIPMENT COMMITMENTS</div>
            <h2>Ex-factory dates</h2>
            <p>Changes are recorded for buyer compliance and traceability.</p>
          </div>
        </div>
        <div className="tna-ship-date-list">
          {orders.map((order) => (
            <article className="tna-ship-date-row" key={order.id}>
              <div className="tna-ship-date-order">
                <strong>{order.po}</strong>
                <span>{order.buyer} · {order.style}</span>
              </div>
              {editingShipOrderId === order.id ? (
                <div className="tna-date-editor">
                  <input
                    type="date"
                    value={editingShipDate}
                    onChange={(event) => setEditingShipDate(event.target.value)}
                    aria-label={`New ex-factory date for ${order.po}`}
                  />
                  <button
                    type="button"
                    className="primary-button"
                    disabled={savingShipOrderId === order.id}
                    onClick={() => void saveShipDate(order.id)}
                  >
                    {savingShipOrderId === order.id ? 'Saving…' : 'Save ship date'}
                  </button>
                  <button type="button" className="secondary-button" onClick={() => { setEditingShipOrderId(null); setEditingShipDate('') }}>Cancel</button>
                </div>
              ) : (
                <>
                  <strong className="tna-ship-date-value">{order.shipDate}</strong>
                  <div className="tna-row-actions">
                    <button type="button" className="secondary-button" onClick={() => startEditingShipDate(order)}>Edit ship date</button>
                    <button type="button" className="secondary-button" onClick={() => void loadAuditHistory(order.id)}>View date history</button>
                  </div>
                </>
              )}
            </article>
          ))}
        </div>
      </section>

      {auditOrderId && (
        <section
          ref={auditPanelRef}
          className="tna-audit-panel"
          aria-label="Order date-change audit history"
          aria-live="polite"
        >
          <div className="section-heading-row">
            <div>
              <div className="eyebrow">COMPLIANCE HISTORY</div>
              <h2>Date changes · {auditOrder?.po ?? 'Order'}</h2>
              <p>Every recorded TNA or ex-factory date change, including who made the change.</p>
            </div>
            <button type="button" className="secondary-button" onClick={() => { setAuditOrderId(null); setAuditEntries([]) }}>Close history</button>
          </div>
          {auditLoading ? (
            <div className="empty-state"><Activity size={22} /><strong>Loading audit history…</strong></div>
          ) : auditError ? (
            <div className="tna-feedback is-error" role="alert">{auditError}</div>
          ) : auditEntries.length === 0 ? (
            <div className="empty-state"><CalendarDays size={22} /><strong>No date changes recorded for this order yet.</strong></div>
          ) : (
            <div>
              {auditEntries.map((entry) => (
                <article className="tna-audit-entry" key={entry.id}>
                  <strong>{entry.fieldName.replace(/:/g, ' · ').replace(/plannedDate/i, 'planned date').replace(/exFactoryDate/i, 'ex-factory date')}</strong>
                  <div className="tna-audit-dates">
                    <span>{formatAuditDate(entry.oldValue)}</span>
                    <b>→</b>
                    <span>{formatAuditDate(entry.newValue)}</span>
                  </div>
                  <small>{entry.changedByName} · {formatAuditDate(entry.changedAt)}</small>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function BuyersWorkspace({
  orders,
  onViewOrders,
}: {
  orders: Order[]
  onViewOrders: (buyerName: string) => void
}) {
  const buyers = useMemo(() => {
    const directory = new Map<string, { name: string; country: string; orderCount: number; pieces: number; attention: number }>()
    orders.forEach((order) => {
      const current = directory.get(order.buyer) ?? {
        name: order.buyer,
        country: order.country,
        orderCount: 0,
        pieces: 0,
        attention: 0,
      }
      current.orderCount += 1
      current.pieces += order.quantity
      if (order.risk === 'At risk' || order.risk === 'Delayed') current.attention += 1
      directory.set(order.buyer, current)
    })
    return [...directory.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [orders])

  return (
    <div className="page-content merchandiser-workspace-page">
      <section className="page-heading">
        <div>
          <div className="eyebrow">CUSTOMER PORTFOLIO</div>
          <h1>Buyer <span>accounts.</span></h1>
          <p className="page-description">A read-only summary of buyer accounts represented in your current order book.</p>
        </div>
      </section>
      {buyers.length === 0 ? (
        <div className="empty-state"><Users size={26} /><strong>No buyer accounts in the order book</strong></div>
      ) : (
        <section className="buyers-directory-grid">
          {buyers.map((buyer) => (
            <article className="buyer-directory-card" key={buyer.name}>
              <div className="buyer-directory-icon"><Users size={20} /></div>
              <h2>{buyer.name}</h2>
              <p>{buyer.country}</p>
              <div className="buyer-directory-stats">
                <span><strong>{buyer.orderCount}</strong> Orders</span>
                <span><strong>{formatNumber(buyer.pieces)}</strong> Pieces</span>
                <span><strong>{buyer.attention}</strong> At risk</span>
              </div>
              <button type="button" className="secondary-button" onClick={() => onViewOrders(buyer.name)}>View buyer orders <ArrowUpRight size={15} /></button>
            </article>
          ))}
        </section>
      )}
    </div>
  )
}

function App() {
// Authentication*
  const [user, setUser] = useState<LoggedInUser | null>(null)

  const [email, setEmail] = useState('')

  const [password, setPassword] = useState('')

  const [loginError, setLoginError] = useState('')

  const [loginLoading, setLoginLoading] = useState(false)
// Orders and API*
  const [orders, setOrders] = useState<Order[]>([])

  const [ordersLoading, setOrdersLoading] = useState(false)

  const [ordersError, setOrdersError] = useState('')

  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
// Dashboard UI*
  const [activeNav, setActiveNav] = useState('Overview')

  const [activeFilter, setActiveFilter] = useState('All orders')

  const [search, setSearch] = useState('')

  const [buyerFilter, setBuyerFilter] = useState('All buyers')

  const [unitFilter, setUnitFilter] = useState('All units')

  const [shipWeekFilter, setShipWeekFilter] = useState('All ship weeks')

  const [showNotifications, setShowNotifications] = useState(false)

  const [showHelp, setShowHelp] = useState(false)

  const [mobileMenu, setMobileMenu] = useState(false)

  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
// Restore an existing session when the page is refreshed.*
  useEffect(() => {

    const savedToken = sessionStorage.getItem('stitchflow_token')

    const savedUser = sessionStorage.getItem('stitchflow_user')

    if (savedToken && savedUser) {

      try {

        setAuthToken(savedToken)

        const restoredUser = JSON.parse(savedUser) as LoggedInUser

        setUser(restoredUser)

        setActiveNav(restoredUser.role === 'BUYER' ? 'My orders' : restoredUser.role === 'SUPERVISOR' ? 'Daily update' : 'Overview')

      } catch {

        sessionStorage.removeItem('stitchflow_token')

        sessionStorage.removeItem('stitchflow_user')

        setAuthToken(null)

      }

    }

  }, [])
// Login*
  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {

    event.preventDefault()

    setLoginError('')

    setLoginLoading(true)

    try {

      const response = await api.post<LoginResponse>('/auth/login', {

        email: email.trim(),

        password,

      })

      const { token, user: loggedInUser } = response.data

      sessionStorage.setItem('stitchflow_token', token)

      sessionStorage.setItem(

        'stitchflow_user',

        JSON.stringify(loggedInUser),

      )

      setAuthToken(token)

      setUser(loggedInUser)

      setActiveNav(loggedInUser.role === 'BUYER' ? 'My orders' : loggedInUser.role === 'SUPERVISOR' ? 'Daily update' : 'Overview')

      setPassword('')

    } catch (error: unknown) {

      const message =

        (error as { response?: { data?: { message?: string } } })

          .response?.data?.message

      setLoginError(message || 'Unable to log in. Please try again.')

    } finally {

      setLoginLoading(false)

    }

  }
// Logout*
  const handleLogout = () => {

    sessionStorage.removeItem('stitchflow_token')

    sessionStorage.removeItem('stitchflow_user')

    setAuthToken(null)

    setUser(null)

    setOrders([])

    setOrdersError('')

    setActiveNav('Overview')

    setActiveFilter('All orders')

    setSearch('')

    setBuyerFilter('All buyers')

    setUnitFilter('All units')

    setShipWeekFilter('All ship weeks')

  }
// Fetch actual orders from the backend after login.*
  useEffect(() => {

    if (!user) return

    let cancelled = false

    const fetchOrders = async () => {

      setOrdersLoading(true)

      setOrdersError('')

      try {

        const response = await api.get<{

          count: number

          orders: ApiOrder[]

        }>('/orders')

        if (cancelled) return

        const fetchedOrders = response.data.orders.map(mapOrder)

        setOrders(fetchedOrders)

        setLastUpdated(new Date())

      } catch (error: unknown) {

        if (cancelled) return

        const message =

          (error as { response?: { data?: { message?: string } } })

            .response?.data?.message

        setOrdersError(

          message || 'Unable to load orders. Check your API connection.',

        )

      } finally {

        if (!cancelled) {

          setOrdersLoading(false)

        }

      }

    }

    fetchOrders()

    return () => {

      cancelled = true

    }

  }, [user])
// Buyer, unit, ship-week, search and status filters.
  const buyerOptions = useMemo(
    () => [...new Set(orders.map((order) => order.buyer).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b)),
    [orders],
  )

  const unitOptions = useMemo(
    () => [...new Set(orders.map((order) => order.unit).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b)),
    [orders],
  )

  const shipWeekOptions = useMemo(() => {
    const options = new Map<string, string>()

    orders.forEach((order) => {
      const week = getIsoShipWeek(order.shipDateISO)
      if (week) options.set(week.key, week.label)
    })

    return [...options.entries()]
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([value, label]) => ({ value, label }))
  }, [orders])

  const resetOrderFilters = () => {
    setActiveFilter('All orders')
    setSearch('')
    setBuyerFilter('All buyers')
    setUnitFilter('All units')
    setShipWeekFilter('All ship weeks')
  }

  const filteredOrders = useMemo(() => {
    const searchText = search.toLowerCase().trim()

    return orders.filter((order) => {
      const matchesStatus =
        activeFilter === 'All orders' || order.risk === activeFilter

      const matchesSearch =
        !searchText ||
        order.po.toLowerCase().includes(searchText) ||
        order.buyer.toLowerCase().includes(searchText) ||
        order.style.toLowerCase().includes(searchText) ||
        order.colour.toLowerCase().includes(searchText)

      const matchesBuyer =
        buyerFilter === 'All buyers' || order.buyer === buyerFilter

      const matchesUnit =
        unitFilter === 'All units' || order.unit === unitFilter

      const orderWeek = getIsoShipWeek(order.shipDateISO)?.key ?? ''
      const matchesShipWeek =
        shipWeekFilter === 'All ship weeks' || orderWeek === shipWeekFilter

      return (
        matchesStatus &&
        matchesSearch &&
        matchesBuyer &&
        matchesUnit &&
        matchesShipWeek
      )
    })
  }, [orders, activeFilter, search, buyerFilter, unitFilter, shipWeekFilter])
// Dashboard calculations use API data.*
  // Dashboard calculations use API data.
const totalOrders = orders.length

const atRisk = orders.filter(
  (order) => order.risk === 'At risk'
).length

const delayed = orders.filter(
  (order) => order.risk === 'Delayed'
).length

const onTrack = orders.filter(
  (order) => order.risk === 'On track'
).length

const totalQuantity = orders.reduce(
  (sum, order) => sum + order.quantity,
  0
)

const completedQuantity = orders.reduce(
  (sum, order) => sum + order.completed,
  0
)

const completion =
  totalQuantity > 0
    ? Math.min(
        100,
        Math.round((completedQuantity / totalQuantity) * 100)
      )
    : 0

const remainingQuantity = Math.max(
  0,
  totalQuantity - completedQuantity
)

  const navClick = (label: string) => {
    if (user.role === 'BUYER' && label !== 'My orders') return
    if (user.role === 'SUPERVISOR' && label !== 'Daily update') return

    setActiveNav(label)
    setMobileMenu(false)
    setSelectedOrder(null)

    if (label === 'Orders') {
      resetOrderFilters()
    }
  }

  const refreshOrders = async () => {

    setOrdersLoading(true)

    setOrdersError('')

    try {

      const response = await api.get<{

        count: number

        orders: ApiOrder[]

      }>('/orders')

      setOrders(response.data.orders.map(mapOrder))

      setLastUpdated(new Date())

    } catch (error: unknown) {

      const message =

        (error as { response?: { data?: { message?: string } } })

          .response?.data?.message

      setOrdersError(message || 'Unable to refresh orders.')

    } finally {

      setOrdersLoading(false)

    }

  }
// Login screen*
  if (!user) {

    return (

      <div className="login-page">

        <form className="login-card" onSubmit={handleLogin}>

          <div className="login-brand">STITCHFLOW</div>

          <div className="login-eyebrow">

            PRODUCTION INTELLIGENCE

          </div>

          <h1>Welcome back.</h1>

          <p>Sign in to access your production workspace.</p>

          <label htmlFor="login-email">Email address</label>

          <input

            id="login-email"

            type="email"

            value={email}

            onChange={(event) => setEmail(event.target.value)}

            placeholder="Enter your email"

            autoComplete="username"

            required

          />

          <label htmlFor="login-password">Password</label>

          <input

            id="login-password"

            type="password"

            value={password}

            onChange={(event) => setPassword(event.target.value)}

            placeholder="Enter your password"

            autoComplete="current-password"

            required

          />

          {loginError && (

            <div className="login-error">{loginError}</div>

          )}

          <button type="submit" disabled={loginLoading}>

            {loginLoading ? 'Signing in...' : 'Sign in'}

          </button>

          <div className="login-footer">

            Secure access for your production team

          </div>

        </form>

      </div>

    )

  }

  return (

    <div className="app-shell">

      {mobileMenu && (

        <button

          className="mobile-overlay"

          onClick={() => setMobileMenu(false)}

          aria-label="Close navigation"

        />

      )}

      <aside

        className={`sidebar ${mobileMenu ? 'sidebar-open' : ''}`}

      >

        <div className="brand">

          <div className="brand-symbol">

            <Shirt size={23} strokeWidth={1.7} />

          </div>

          <div>

            <div className="brand-name">STITCHFLOW</div>

            <div className="brand-caption">

              PRODUCTION INTELLIGENCE

            </div>

          </div>

          <button

            className="mobile-close"

            onClick={() => setMobileMenu(false)}

            aria-label="Close menu"

          >

            <X size={19} />

          </button>

        </div>

        <div className="workspace-label">{user.role === 'SUPERVISOR' ? 'UNIT WORKSPACE' : 'WORKSPACE'}</div>

        <nav className="nav-list">

          {(user.role === 'BUYER' ? buyerNavigation : user.role === 'SUPERVISOR' ? supervisorNavigation : navigation).map(({ label, icon: Icon }) => (

            <button

              key={label}

              onClick={() => navClick(label)}

              className={`nav-item ${

                activeNav === label ? 'active' : ''

              }`}

            >

              <Icon size={18} strokeWidth={1.8} />

              <span>{label}</span>

              {label === 'Orders' && (

                <span className="nav-count">{totalOrders}</span>

              )}

            </button>

          ))}

        </nav>

        {user.role === 'MERCHANDISER' && (
          <>
            <div className="workspace-label secondary-label">MANAGEMENT</div>
            <nav className="nav-list">
              {secondaryNavigation.map(({ label, icon: Icon }) => (
                <button
                  key={label}
                  onClick={() => navClick(label)}
                  className={`nav-item ${activeNav === label ? 'active' : ''}`}
                >
                  <Icon size={18} strokeWidth={1.8} />
                  <span>{label}</span>
                </button>
              ))}
            </nav>
          </>
        )}

        <div className="sidebar-spacer" />

        <div className="factory-card">

          <div className="factory-icon">

            <Factory size={19} />

          </div>

          <div className="factory-info">

            <strong>{user.role === 'BUYER' ? (orders[0]?.buyer ?? 'Buyer account') : 'Company A'}</strong>

            <span>{user.role === 'BUYER' ? (orders[0]?.country ?? 'Buyer workspace') : 'Tiruppur, India'}</span>

          </div>

          <span className="online-dot" />

        </div>

        <div className="profile">

          <div className="avatar">

            {user.name

              .split(' ')

              .map((part) => part[0])

              .join('')

              .slice(0, 2)

              .toUpperCase()}

          </div>

          <div className="profile-info">

            <strong>{user.name}</strong>

            <span>{user.role.replace('_', ' ')}</span>

          </div>

          <button

            className="row-more"

            onClick={handleLogout}

            aria-label="Log out"

            title="Log out"

          >

            <LogOut size={18} />

          </button>

        </div>

      </aside>

      <main className="main-content">

        <header className="topbar">

          <div className="topbar-left">

            <button

              className="mobile-menu-button"

              onClick={() => setMobileMenu(true)}

              aria-label="Open menu"

            >

              <Menu size={21} />

            </button>

            <div className="breadcrumb">

              <span>Workspace</span>

              <span className="breadcrumb-divider">/</span>

              <strong>{user.role === 'BUYER' ? 'My orders' : activeNav}</strong>

            </div>

          </div>

          <div className="topbar-right">

            <div className="live-indicator">

              <span />

              CONNECTED

            </div>

            {user.role !== 'BUYER' && (
            <button

              className="icon-button notification-button"

              onClick={() =>

                setShowNotifications(!showNotifications)

              }

              aria-label="Notifications"

            >

              <Bell size={19} />

              <span className="notification-dot" />

            </button>
            )}

            <button

              className="help-button"

              onClick={() => setShowHelp(!showHelp)}

            >

              <CircleHelp size={17} />

              <span>Help</span>

            </button>

          </div>

          {user.role !== 'BUYER' && showNotifications && (

            <div className="notification-panel">

              <strong>Order notifications</strong>

              <p>{atRisk} orders require closer monitoring.</p>

              <p>{delayed} orders are marked delayed.</p>

            </div>

          )}

          {showHelp && (

            <div className="notification-panel">

              <strong>StitchFlow help</strong>

              <p>

                Contact your system administrator for workspace

                assistance.

              </p>

              <button onClick={() => setShowHelp(false)}>

                Close

              </button>

            </div>

          )}

        </header>

        {user.role === 'BUYER' ? (
          <BuyerWorkspace
            orders={orders}
            ordersLoading={ordersLoading}
            ordersError={ordersError}
            refreshOrders={refreshOrders}
          />
        ) : user.role === 'SUPERVISOR' ? (
          <SupervisorWorkspace
            currentUserId={user.id}
            orders={orders}
            ordersLoading={ordersLoading}
            refreshOrders={refreshOrders}
          />
        ) : user.role === 'MERCHANDISER' && activeNav === 'AI Review' ? (
          <IssueReviewWorkspace />
        ) : user.role === 'MERCHANDISER' && activeNav === 'Production' ? (
          <MerchandiserProductionWorkspace />
        ) : user.role === 'MERCHANDISER' && activeNav === 'TNA Calendar' ? (
          <TnaCalendarWorkspace
            orders={orders}
            ordersLoading={ordersLoading}
            refreshOrders={refreshOrders}
            onOpenOrder={(order) => {
              setSelectedOrder(order)
              setActiveNav('Orders')
              setActiveFilter('All orders')
              setSearch(order.po)
            }}
          />
        ) : user.role === 'MERCHANDISER' && activeNav === 'Buyers' ? (
          <BuyersWorkspace
            orders={orders}
            onViewOrders={(buyerName) => {
              setActiveFilter('All orders')
              setSearch(buyerName)
              setActiveNav('Orders')
            }}
          />
        ) : user.role === 'MERCHANDISER' && activeNav === 'Create Order' ? (

          <OrderSetupWorkspace
            onCancel={() => navClick('Orders')}
            refreshOrders={refreshOrders}
          />

        ) : (

          <div className="page-content">

          <section className="page-heading">

            <div>

              <div className="eyebrow">

                PRODUCTION WORKSPACE

              </div>

              <h1>
                {activeNav === 'Orders' ? <>Production <span>orders.</span></> : <>Production <span>overview.</span></>}
              </h1>

              <p className="page-description">
                {activeNav === 'Orders'
                  ? 'Search, filter and inspect production orders across buyers and units.'
                  : "A clear picture of what's moving, what's waiting, and what needs your attention."}
              </p>

            </div>

            {user.role === 'MERCHANDISER' ? (
              <button
                className="primary-button"
                onClick={() => navClick('Create Order')}
                type="button"
              >
                <Plus size={18} />
                Create order
              </button>
            ) : (
              <button
                className="primary-button"
                onClick={() => navClick('Orders')}
                type="button"
              >
                <Plus size={18} />
                View orders
              </button>
            )}

          </section>

          {ordersError && (

            <div className="login-error" role="alert">

              {ordersError}

              <button

                onClick={refreshOrders}

                style={{ marginLeft: 12 }}

              >

                Retry

              </button>

            </div>

          )}

          {activeNav === 'Overview' && (
          <section className="stats-grid">

            <article className="stat-card">

              <div className="stat-top">

                <span>Total active orders</span>

                <div className="stat-icon neutral">

                  <Package size={19} />

                </div>

              </div>

              <div className="stat-value">

                {ordersLoading ? '—' : totalOrders}

              </div>

              <div className="stat-bottom">

                <span className="stat-note">

                  Across production units

                </span>

              </div>

            </article>

            <article className="stat-card">

              <div className="stat-top">

                <span>On track</span>

                <div className="stat-icon positive">

                  <CheckCircle2 size={19} />

                </div>

              </div>

              <div className="stat-value">

                {ordersLoading ? '—' : onTrack}

              </div>

              <div className="stat-bottom">

                <span className="status-dot green" />

                <span className="stat-note">

                  Within production plan

                </span>

              </div>

            </article>

            <article className="stat-card">

              <div className="stat-top">

                <span>At risk</span>

                <div className="stat-icon warning">

                  <AlertTriangle size={19} />

                </div>

              </div>

              <div className="stat-value">

                {ordersLoading ? '—' : atRisk}

              </div>

              <div className="stat-bottom">

                <span className="status-dot amber" />

                <span className="stat-note">

                  Needs closer monitoring

                </span>

              </div>

            </article>

            <article className="stat-card">

              <div className="stat-top">

                <span>Delayed</span>

                <div className="stat-icon danger">

                  <Clock3 size={19} />

                </div>

              </div>

              <div className="stat-value">

                {ordersLoading ? '—' : delayed}

              </div>

              <div className="stat-bottom">

                <span className="status-dot red" />

                <span className="stat-note">

                  Requires intervention

                </span>

              </div>

            </article>

          </section>
          )}

          {activeNav === 'Overview' && (
          <section className="insight-grid">

            <article className="production-card">

              <div className="section-heading">

                <div>

                  <div className="eyebrow">

                    FACTORY PERFORMANCE

                  </div>

                  <h2>Production progress</h2>

                </div>

                <span className="period-tag">

                  Current orders

                </span>

              </div>

              <div className="production-number-row">

                <div>

                  <div className="big-percentage">

                    {ordersLoading ? '—' : `${completion}%`}

                  </div>

                  <div className="muted-text">

                    Overall quantity completed

                  </div>

                </div>

                <div className="production-legend">

                  <span>

                    <i className="legend-complete" /> Completed

                  </span>

                  <span>

                    <i className="legend-remaining" /> Remaining

                  </span>

                </div>

              </div>

              <div className="progress-track">

                <div

                  className="progress-completed"

                  style={{

                    width: `${ordersLoading ? 0 : completion}%`,

                  }}

                />

              </div>

              <div className="production-footer">

                <div>

                  <strong>

                    {formatNumber(completedQuantity)}

                  </strong>

                  <span>Pieces completed</span>

                </div>

                <div>

                  <strong>

                    {formatNumber(remainingQuantity)}

                  </strong>

                  <span>Pieces remaining</span>

                </div>

                <div>

                  <strong>{formatNumber(totalQuantity)}</strong>

                  <span>Total order quantity</span>

                </div>

              </div>

            </article>

            <article className="attention-card">

              <div className="attention-header">

                <div className="attention-icon">

                  <Activity size={18} />

                </div>

                <span>ATTENTION REQUIRED</span>

              </div>

              <div className="attention-number">

                {atRisk + delayed}

              </div>

              <h3>Orders need attention</h3>

              <p>

                {atRisk} at-risk and {delayed} delayed orders

                are currently flagged in your workspace.

              </p>

              <button

                className="attention-link"

                onClick={() => {

                  setActiveFilter('At risk')

                  setActiveNav('Orders')

                }}

              >

                Review at-risk orders

                <ArrowUpRight size={16} />

              </button>

            </article>

          </section>
          )}

          <section className="orders-section">

            <div className="orders-heading">

              <div>

                <div className="eyebrow">ORDER MANAGEMENT</div>

                <h2>Production orders</h2>

                <p>

                  Monitor progress across buyers and production units.

                </p>

              </div>

              <div className="orders-heading-actions">
                {activeNav !== 'Orders' && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => navClick('Orders')}
                  >
                    View all orders
                    <ArrowUpRight size={16} />
                  </button>
                )}
              </div>

            </div>

            <div className="table-toolbar">

              <div className="filter-tabs">

                {[

                  'All orders',

                  'On track',

                  'At risk',

                  'Delayed',

                  'Completed',

                ].map((filter) => (

                  <button

                    key={filter}

                    className={`filter-tab ${

                      activeFilter === filter ? 'selected' : ''

                    }`}

                    onClick={() => setActiveFilter(filter)}

                  >

                    {filter}

                    {filter === 'All orders' && (

                      <span>{totalOrders}</span>

                    )}

                  </button>

                ))}

              </div>

              <div className="table-actions">

                <div className="search-box">

                  <Search size={16} />

                  <input

                    placeholder="Search orders..."

                    value={search}

                    onChange={(event) =>

                      setSearch(event.target.value)

                    }

                  />

                  {search && (

                    <button

                      onClick={() => setSearch('')}

                      aria-label="Clear search"

                    >

                      <X size={14} />

                    </button>

                  )}

                </div>

                <button
                  type="button"
                  className="filter-button order-reset-button"
                  onClick={resetOrderFilters}
                  title="Clear search, status, buyer, unit and ship-week filters"
                  aria-label="Reset all order filters"
                >
                  <Filter size={16} />
                  <span>Reset filters</span>
                </button>

                <button

                  className="icon-button"

                  onClick={refreshOrders}

                  disabled={ordersLoading}

                  aria-label="Refresh orders"

                  title="Refresh orders"

                >

                  <Activity size={17} />

                </button>

              </div>

            </div>

            <div className="order-extra-filters" aria-label="Additional order filters">
              <label className="order-filter-field" htmlFor="order-buyer-filter">
                <span>Buyer</span>
                <select
                  id="order-buyer-filter"
                  value={buyerFilter}
                  onChange={(event) => setBuyerFilter(event.target.value)}
                >
                  <option value="All buyers">All buyers</option>
                  {buyerOptions.map((buyer) => (
                    <option key={buyer} value={buyer}>{buyer}</option>
                  ))}
                </select>
              </label>

              <label className="order-filter-field" htmlFor="order-unit-filter">
                <span>Production unit</span>
                <select
                  id="order-unit-filter"
                  value={unitFilter}
                  onChange={(event) => setUnitFilter(event.target.value)}
                >
                  <option value="All units">All units</option>
                  {unitOptions.map((unit) => (
                    <option key={unit} value={unit}>{unit}</option>
                  ))}
                </select>
              </label>

              <label className="order-filter-field" htmlFor="order-ship-week-filter">
                <span>Ship week (ISO)</span>
                <select
                  id="order-ship-week-filter"
                  value={shipWeekFilter}
                  onChange={(event) => setShipWeekFilter(event.target.value)}
                >
                  <option value="All ship weeks">All ship weeks</option>
                  {shipWeekOptions.map((week) => (
                    <option key={week.value} value={week.value}>{week.label}</option>
                  ))}
                </select>
              </label>
</div>

            <div className="table-scroll">

              {ordersLoading ? (

                <div className="empty-state">

                  <Activity size={26} />

                  <strong>Loading production orders...</strong>

                  <span>Connecting to the StitchFlow API.</span>

                </div>

              ) : (

                <table className="orders-table">

                  <thead>

                    <tr>

                      <th>ORDER / BUYER</th>

                      <th>PRODUCT</th>

                      <th>PRODUCTION</th>

                      <th>STAGE</th>

                      <th>EX-FACTORY</th>

                      <th>STATUS</th>

                      <th />

                    </tr>

                  </thead>

                  <tbody>

                    {filteredOrders.map((order) => {

                      const percentage =

                        order.quantity > 0

                          ? Math.min(

                              100,

                              Math.round(

                                (order.completed / order.quantity) *

                                  100,

                              ),

                            )

                          : 0

                      return (

                        <tr key={order.id}>

                          <td>

                            <strong className="po-number">

                              {order.po}

                            </strong>

                            <span className="cell-subtext">

                              {order.buyer} · {order.country}

                            </span>

                          </td>

                          <td>

                            <strong>{order.style}</strong>

                            <span className="cell-subtext">

                              {order.colour} · {order.unit}

                            </span>

                          </td>

                          <td>

                            <div className="quantity-label">

                              {formatNumber(order.completed)}

                              <span>

                                {' '}

                                / {formatNumber(order.quantity)}

                              </span>

                            </div>

                            <div className="mini-progress">

                              <div

                                style={{ width: `${percentage}%` }}

                              />

                            </div>

                            <span className="cell-subtext">

                              {percentage}% complete

                            </span>

                          </td>

                          <td>

                            <span className="stage-label">

                              {order.stage}

                            </span>

                          </td>

                          <td>

                            <span className="date-label">

                              {order.shipDate}

                            </span>

                          </td>

                          <td>
                            <div className="risk-status-cell">
                              <span
                                className={`risk-badge ${order.risk
                                  .toLowerCase()
                                  .replace(' ', '-')}`}
                              >
                                <span />
                                {order.risk}
                              </span>
                              {order.riskAnalysis && order.risk !== 'Completed' && (
                                <span className="risk-math-caption">
                                  {order.riskAnalysis.requiredDailyRate !== null
                                    ? `Need ${formatNumber(Math.ceil(order.riskAnalysis.requiredDailyRate))}/day`
                                    : `${order.riskAnalysis.daysLeft} days left`}
                                  {' · '}
                                  {`Avg ${formatNumber(Math.round(order.riskAnalysis.actualDailyRate))}/day`}
                                </span>
                              )}
                            </div>
                          </td>

                          <td>

                            <button

                              className="row-more"

                              onClick={() =>

                                setSelectedOrder(

                                  selectedOrder?.id === order.id

                                    ? null

                                    : order,

                                )

                              }

                              aria-label={`View ${order.po} details`}

                              title="View order details"

                            >

                              <MoreHorizontal size={19} />

                            </button>

                          </td>

                        </tr>

                      )

                    })}

                  </tbody>

                </table>

              )}

              {!ordersLoading && filteredOrders.length === 0 && (

                <div className="empty-state">

                  <Package size={26} />

                  <strong>

                    {orders.length === 0

                      ? 'No orders available'

                      : 'No matching orders'}

                  </strong>

                  <span>

                    {orders.length === 0

                      ? 'Orders will appear here when available to your account.'

                      : 'Try changing your search or status filter.'}

                  </span>

                  <button

                    onClick={resetOrderFilters}

                  >

                    Clear filters

                  </button>

                </div>

              )}

            </div>

            {selectedOrder && (

              <div className="notification-panel order-details-panel">

                <strong>{selectedOrder.po}</strong>

                <p>

                  Buyer: {selectedOrder.buyer} (

                  {selectedOrder.country})

                </p>

                <p>Style: {selectedOrder.style}</p>

                <p>

                  Production: {formatNumber(selectedOrder.completed)} /

                  {' '}

                  {formatNumber(selectedOrder.quantity)} pieces

                </p>

                <p>Current stage: {selectedOrder.stage}</p>

                <p>Ex-factory: {selectedOrder.shipDate}</p>

                <p>Status: {selectedOrder.risk}</p>
                {selectedOrder.riskAnalysis && (
                  <div className="risk-analysis-detail">
                    <strong>Run-rate projection</strong>
                    <p>{selectedOrder.riskAnalysis.reason}</p>
                    <div className="risk-analysis-metrics">
                      <span>
                        Required rate
                        <strong>
                          {selectedOrder.riskAnalysis.requiredDailyRate === null
                            ? '—'
                            : `${formatNumber(Math.ceil(selectedOrder.riskAnalysis.requiredDailyRate))} pcs/day`}
                        </strong>
                      </span>
                      <span>
                        Recent average
                        <strong>
                          {formatNumber(Math.round(selectedOrder.riskAnalysis.actualDailyRate))} pcs/day
                        </strong>
                      </span>
                      <span>
                        Days remaining
                        <strong>{selectedOrder.riskAnalysis.daysLeft}</strong>
                      </span>
                      <span>
                        Reporting days
                        <strong>
                          {selectedOrder.riskAnalysis.reportingDays} of {selectedOrder.riskAnalysis.lookbackDays}
                        </strong>
                      </span>
                    </div>
                    <small>
                      Required rate = {formatNumber(selectedOrder.riskAnalysis.remainingQuantity)} remaining pieces ÷ {selectedOrder.riskAnalysis.daysLeft} calendar days = {selectedOrder.riskAnalysis.requiredDailyRate === null ? 'not available' : `${formatNumber(Math.ceil(selectedOrder.riskAnalysis.requiredDailyRate))} pieces/day`}. Actual rate = {formatNumber(selectedOrder.riskAnalysis.recentOutputPieces)} reported pieces ÷ {selectedOrder.riskAnalysis.lookbackDays} calendar days = {formatNumber(Math.round(selectedOrder.riskAnalysis.actualDailyRate))} pieces/day. Uses the current TNA stage; days without reports count as zero.
                    </small>
                  </div>
                )}

                <button onClick={() => setSelectedOrder(null)}>

                  Close details

                </button>

              </div>

            )}

            <div className="table-footer">

              <span>

                Showing {filteredOrders.length} of {totalOrders} orders

              </span>

              <span>

                {lastUpdated

                  ? `Last updated: ${lastUpdated.toLocaleTimeString()}`

                  : 'Waiting for data'}

              </span>

            </div>

          </section>

          <footer className="page-footer">

            <span>STITCHFLOW © 2026</span>

            <span>

              BUILT FOR BETTER PRODUCTION VISIBILITY

            </span>

          </footer>

          </div>

        )}

      </main>

    </div>

  )

}

export default App
