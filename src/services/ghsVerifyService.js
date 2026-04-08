import axios from 'axios'
import config from '../../config.js'
import logger from '../utils/logger.js'
import ghsVerifyJobsDb from '../database/ghsVerifyJobs.js'

const REQUEST_TIMEOUT = 60 * 1000
const POLL_INTERVAL_MS = 60 * 1000
const UPDATE_DELAY_MS = 5000
const POLL_ERROR_THRESHOLD = 5
const FAST_LOGIN_POLL_INTERVAL_MS = 1000
const FAST_LOGIN_POLL_TIMEOUT_MS = 90000
const FAST_LOGIN_ERROR_THRESHOLD = 3

const TERMINAL_SUCCESS = new Set(['success', 'succeeded', 'approved', 'done', 'completed', 'verified'])
const TERMINAL_FAILED = new Set(['failed', 'failure', 'error', 'invalid', 'rejected', 'expired', 'cancelled', 'canceled', 'timeout'])
const LOGIN_WAIT_PHASE = new Set(['queued', 'logging_in', 'authenticating', 'login', 'verifying_otp'])
const LOGIN_SUCCESS_PHASE = new Set(['checking_account', 'generating_proof', 'submitting', 'pending'])
const LOGIN_FAILED_HINTS = [
    /otp failed/i,
    /login failed/i,
    /two-factor/i,
    /invalid credentials/i,
    /sessions\/two-factor/i
]

const clean = (value) => String(value || '').trim()
const normalizeStatus = (value) => clean(value).toLowerCase() || 'pending'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const asObject = (value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value
    return {}
}

const normalizeBaseUrl = () => clean(config.ahsanlabsBaseUrl || 'http://api.ahsanlabs.online').replace(/\/+$/, '')
const getApiKey = () => clean(config.ahsanlabsApiKey || '')

const getRoots = (payload) => {
    const root = asObject(payload)
    const data = asObject(root.data)
    const result = asObject(root.result)
    return [root, data, result]
}

const pickFirstText = (payload, keys = []) => {
    const roots = getRoots(payload)
    for (const r of roots) {
        for (const key of keys) {
            const value = clean(r?.[key])
            if (value) return value
        }
    }
    return ''
}

const pickFirstNumber = (payload, keys = []) => {
    const roots = getRoots(payload)
    for (const r of roots) {
        for (const key of keys) {
            const raw = r?.[key]
            if (raw === null || raw === undefined) continue
            if (typeof raw === 'string' && raw.trim() === '') continue
            const n = Number(raw)
            if (Number.isFinite(n)) return n
        }
    }
    return null
}

const pickMessage = (payload) => pickFirstText(payload, ['message', 'msg', 'error'])
const extractJobId = (payload) => pickFirstText(payload, ['job_id', 'jobId', 'jobID', 'id'])

const extractStatus = (payload) => {
    const status = pickFirstText(payload, ['status', 'state', 'job_status', 'jobStatus'])
    if (status) return normalizeStatus(status)

    const root = asObject(payload)
    if (root.success === true || root.done === true || root.completed === true) return 'success'
    if (root.success === false || root.error) return 'failed'
    return 'pending'
}

const extractApplicationId = (payload) => pickFirstText(payload, ['application_id', 'applicationId', 'app_id', 'appId', 'id'])

const extractElapsedSeconds = (payload) => {
    const seconds = pickFirstNumber(payload, ['elapsed_seconds', 'elapsedSeconds', 'duration_seconds', 'durationSeconds', 'elapsed'])
    if (seconds !== null) return Math.max(0, Math.round(seconds))

    const createdAt = pickFirstText(payload, ['created_at', 'createdAt'])
    const updatedAt = pickFirstText(payload, ['updated_at', 'updatedAt'])
    if (!createdAt || !updatedAt) return null

    const toTs = (v) => {
        const iso = v.includes('T') ? v : v.replace(' ', 'T')
        const direct = Date.parse(iso)
        if (Number.isFinite(direct)) return direct
        const utc = Date.parse(`${iso}Z`)
        return Number.isFinite(utc) ? utc : NaN
    }

    const fromTs = toTs(createdAt)
    const toTsVal = toTs(updatedAt)
    if (!Number.isFinite(fromTs) || !Number.isFinite(toTsVal) || toTsVal < fromTs) return null
    return Math.round((toTsVal - fromTs) / 1000)
}

const extractCreditsChargedText = (payload) => {
    const raw = pickFirstText(payload, ['credits_charged', 'creditsCharged', 'credit_charged', 'creditCharged'])
    if (!raw) return ''
    return Number.isFinite(Number(raw)) ? raw : ''
}
const extractCreditsRemaining = (payload) => pickFirstNumber(payload, [
    'credits_remaining',
    'creditsRemaining',
    'api_credits_available',
    'apiCreditsAvailable',
    'remaining',
    'balance',
    'saldo'
])

const isTerminalStatus = (status) => TERMINAL_SUCCESS.has(normalizeStatus(status)) || TERMINAL_FAILED.has(normalizeStatus(status))
const isLoginWaitingPhase = (status) => LOGIN_WAIT_PHASE.has(normalizeStatus(status))
const isLoginSuccessPhase = (status) => LOGIN_SUCCESS_PHASE.has(normalizeStatus(status))

const isAuthApiError = (info = '') => /invalid or revoked api key|http\s*401|unauthorized|missing api key/i.test(clean(info).toLowerCase())

const sanitizeInfo = (value = '') => {
    const text = clean(value)
    if (!text) return '-'
    if (isAuthApiError(text)) return 'proses verifikasi tidak tersedia sementara, silakan coba lagi.'
    return text
}

const formatNumber = (value) => {
    const n = Number(value)
    if (!Number.isFinite(n)) return '-'
    if (Number.isInteger(n)) return String(n)
    return String(n)
}

const formatApiError = (err) => {
    const status = err?.response?.status
    const data = err?.response?.data
    const message = pickMessage(asObject(data)) || clean(err?.message) || 'Unknown error'
    return status ? `HTTP ${status} - ${message}` : message
}

const trimLoginFailPrefix = (message = '') => clean(message).replace(/^(otp failed|login failed)\s*:\s*/i, '').trim()

const isLoginFailureBeforeVerify = ({ status, message, loginSuccessNotified }) => {
    if (loginSuccessNotified === true) return false
    const normalized = normalizeStatus(status)
    if (normalized !== 'failed') return false
    const text = clean(message)
    if (!text) return true
    return LOGIN_FAILED_HINTS.some((pattern) => pattern.test(text))
}

class GhsVerifyService {
    constructor() {
        this._sock = null
        this._workerTimer = null
        this._isTicking = false
    }

    setSock(sock) {
        this._sock = sock || null
    }

    startWorker(sock) {
        if (sock) this.setSock(sock)
        if (this._workerTimer) return

        this._workerTimer = setInterval(() => {
            void this.runWorkerTick()
        }, POLL_INTERVAL_MS)

        logger.info('[GHS] worker polling aktif (interval 1 menit)')
    }

    async _request(method, path, { data, params } = {}) {
        const apiKey = getApiKey()
        if (!apiKey) throw new Error('ahsanlabsApiKey belum di-set di config.js')

        const url = `${normalizeBaseUrl()}${path}`

        try {
            const response = await axios({
                method,
                url,
                data,
                params,
                timeout: REQUEST_TIMEOUT,
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    Accept: 'application/json,text/plain,*/*'
                },
                validateStatus: () => true
            })

            if (response.status >= 400) {
                const message = pickMessage(asObject(response.data)) || `HTTP ${response.status}`
                const err = new Error(message)
                err.response = { status: response.status, data: response.data }
                throw err
            }

            return response.data
        } catch (err) {
            throw new Error(formatApiError(err))
        }
    }

    async fetchCredits() {
        return this._request('GET', '/api/credits')
    }

    async verifyAccount({ email, password, otp, role = 'student', chatJid, requesterJid, requesterName = '' }) {
        const payload = await this._request('POST', '/api/verify', {
            data: {
                email: clean(email),
                password: clean(password),
                otp: clean(otp),
                role: clean(role) || 'student'
            }
        })

        const jobId = extractJobId(payload)
        if (!jobId) throw new Error('Respons verifikasi tidak mengembalikan job id')

        const status = extractStatus(payload)
        const active = !isTerminalStatus(status)

        const savedJob = await ghsVerifyJobsDb.upsertFromVerify({
            jobId,
            chatJid,
            requesterJid,
            requesterName,
            email,
            role,
            status,
            verifyResponse: payload,
            active
        })

        return { payload, jobId, status, active, savedJob }
    }

    async submitVerificationFlow({ email, password, otp, role = 'student', chatJid, requesterJid, requesterName = '' }) {
        try {
            await ghsVerifyJobsDb.deactivateActiveByChatEmail(chatJid, email).catch(() => {})

            const result = await this.verifyAccount({
                email,
                password,
                otp,
                role,
                chatJid,
                requesterJid,
                requesterName
            })

            await this._runFastLoginPolling(
                result.savedJob || {
                    jobId: result.jobId,
                    status: result.status,
                    chatJid,
                    email,
                    loginSuccessNotified: false,
                    pollErrorCount: 0
                }
            )

            return result
        } catch (err) {
            logger.warn(`[GHS] submit verification gagal: ${clean(err?.message || err)}`)
            return null
        }
    }

    async _runFastLoginPolling(initialJob) {
        const baseJob = initialJob || {}
        if (!baseJob.jobId) return

        const startedAt = Date.now()
        let currentJob = {
            ...baseJob,
            loginSuccessNotified: baseJob.loginSuccessNotified === true,
            pollErrorCount: Number(baseJob.pollErrorCount || 0)
        }

        while (Date.now() - startedAt < FAST_LOGIN_POLL_TIMEOUT_MS) {
            try {
                const check = await this.checkJob(currentJob.jobId)
                const status = normalizeStatus(check.status)
                const terminal = isTerminalStatus(status)
                const statusMessage = pickMessage(check.payload)

                if (terminal && isLoginFailureBeforeVerify({
                    status,
                    message: statusMessage,
                    loginSuccessNotified: currentJob.loginSuccessNotified
                })) {
                    const updated = await ghsVerifyJobsDb.updateFromJobCheck(currentJob.jobId, {
                        status,
                        active: false,
                        lastResponse: check.payload,
                        errorMessage: '',
                        pollErrorCount: 0
                    })

                    if (updated) currentJob = updated

                    await this._sendProgressMessage({
                        chatJid: currentJob.chatJid,
                        email: currentJob.email,
                        statusText: 'gagal login...',
                        infoText: trimLoginFailPrefix(statusMessage || '-')
                    })
                    return
                }

                const updated = await ghsVerifyJobsDb.updateFromJobCheck(currentJob.jobId, {
                    status,
                    active: true,
                    lastResponse: check.payload,
                    errorMessage: '',
                    pollErrorCount: 0
                })

                if (updated) currentJob = updated

                if (!currentJob.loginSuccessNotified && isLoginSuccessPhase(status) && !terminal) {
                    const sent = await this._sendProgressMessage({
                        chatJid: currentJob.chatJid,
                        email: currentJob.email,
                        statusText: 'login berhasil!',
                        infoText: 'proses verifikasi github student, tunggu 5 menit.'
                    })

                    if (sent) {
                        await ghsVerifyJobsDb.markLoginSuccessNotified(currentJob.jobId).catch(() => {})
                        currentJob.loginSuccessNotified = true
                    }
                }

                if (terminal || currentJob.loginSuccessNotified) return
                if (!isLoginWaitingPhase(status)) continue
            } catch (err) {
                const message = clean(err?.message || err)
                const nextErrCount = Number(currentJob.pollErrorCount || 0) + 1
                currentJob.pollErrorCount = nextErrCount

                logger.warn(`[GHS] fast poll job ${currentJob.jobId} gagal: ${message}`)

                await ghsVerifyJobsDb.updateFromJobCheck(currentJob.jobId, {
                    status: currentJob.status || 'pending',
                    active: true,
                    lastResponse: null,
                    errorMessage: message,
                    pollErrorCount: nextErrCount
                }).catch(() => {})

                if (nextErrCount >= FAST_LOGIN_ERROR_THRESHOLD) return
            }

            await sleep(FAST_LOGIN_POLL_INTERVAL_MS)
        }
    }

    async checkJob(jobId) {
        const payload = await this._request('GET', `/api/job/${encodeURIComponent(clean(jobId))}`)
        const status = extractStatus(payload)
        const active = !isTerminalStatus(status)
        return { payload, status, active }
    }

    async runWorkerTick() {
        if (this._isTicking) return
        this._isTicking = true
        try {
            const jobs = await ghsVerifyJobsDb.getActiveJobs(200)
            if (!jobs.length) return

            for (const job of jobs) {
                await this._pollSingleJob(job, { notifyTerminal: true })
            }
        } catch (err) {
            logger.warn(`[GHS] worker tick gagal: ${clean(err?.message || err)}`)
        } finally {
            this._isTicking = false
        }
    }

    async _pollSingleJob(job, options = {}) {
        const notifyTerminal = options.notifyTerminal !== false

        try {
            const check = await this.checkJob(job.jobId)
            const status = normalizeStatus(check.status)
            const terminal = isTerminalStatus(status)
            const statusMessage = pickMessage(check.payload)

            if (terminal && isLoginFailureBeforeVerify({
                status,
                message: statusMessage,
                loginSuccessNotified: job.loginSuccessNotified
            })) {
                const updated = await ghsVerifyJobsDb.updateFromJobCheck(job.jobId, {
                    status,
                    active: false,
                    lastResponse: check.payload,
                    errorMessage: '',
                    pollErrorCount: 0
                })

                await this._sendProgressMessage({
                    chatJid: updated?.chatJid || job.chatJid,
                    email: updated?.email || job.email,
                    statusText: 'gagal login...',
                    infoText: trimLoginFailPrefix(statusMessage || '-')
                })
                return
            }

            const updated = await ghsVerifyJobsDb.updateFromJobCheck(job.jobId, {
                status,
                active: terminal ? (notifyTerminal ? false : true) : true,
                lastResponse: check.payload,
                errorMessage: '',
                pollErrorCount: 0
            })

            if (!updated) return

            if (!updated.loginSuccessNotified && isLoginSuccessPhase(status) && !terminal) {
                const sent = await this._sendProgressMessage({
                    chatJid: updated.chatJid,
                    email: updated.email,
                    statusText: 'login berhasil!',
                    infoText: 'proses verifikasi github student, tunggu 5 menit.'
                })
                if (sent) {
                    await ghsVerifyJobsDb.markLoginSuccessNotified(updated.jobId).catch(() => {})
                }
            }

            if (terminal && notifyTerminal && normalizeStatus(updated.lastNotifiedStatus) !== status) {
                const sent = await this._sendTerminalMessage(updated, check.payload, status)
                if (sent) {
                    await ghsVerifyJobsDb.markNotified(updated.jobId, status).catch(() => {})
                }
            }
        } catch (err) {
            const message = clean(err?.message || err)
            logger.warn(`[GHS] poll job ${job.jobId} gagal: ${message}`)

            const notFound = /\b404\b|not found|job.*not.*found/i.test(message.toLowerCase())
            const authErr = isAuthApiError(message)
            const nextErrCount = authErr ? Number(job.pollErrorCount || 0) + 1 : 0
            const mustFail = notFound || nextErrCount >= POLL_ERROR_THRESHOLD

            if (mustFail) {
                const sent = await this._sendTerminalMessage(
                    { chatJid: job.chatJid, email: job.email },
                    { message },
                    'failed'
                )

                await ghsVerifyJobsDb.updateFromJobCheck(job.jobId, {
                    status: 'failed',
                    active: false,
                    lastResponse: null,
                    errorMessage: message,
                    pollErrorCount: nextErrCount
                }).catch(() => {})

                if (sent) {
                    await ghsVerifyJobsDb.markNotified(job.jobId, 'failed').catch(() => {})
                }
                return
            }

            await ghsVerifyJobsDb.updateFromJobCheck(job.jobId, {
                status: job.status || 'pending',
                active: true,
                lastResponse: null,
                errorMessage: message,
                pollErrorCount: nextErrCount
            }).catch(() => {})
        }
    }

    async _resolveBalance(payload) {
        const fromJob = extractCreditsRemaining(payload)
        if (fromJob !== null) return fromJob

        try {
            const credits = await this.fetchCredits()
            const available = pickFirstNumber(credits, [
                'api_credits_available',
                'credits',
                'balance',
                'saldo',
                'remaining'
            ])
            if (available !== null) return available
        } catch {}

        return null
    }

    _buildApprovedMessage({ applicationId, elapsedSeconds, creditChargedText, balance }) {
        return [
            '🎉 APPLICATION APPROVED!',
            '',
            'Your github student developer pack has been approved!',
            '',
            `- Verified in: ${Number.isFinite(elapsedSeconds) ? `${elapsedSeconds}s` : '-'}`,
            `- Credit charged: ${clean(creditChargedText) || '-'}`,
            `- Balance: ${formatNumber(balance)}`,
            '',
            '🌟 Congratulations! your benefits will become available within 72 hours.'
        ].join('\n')
    }

    _buildRejectedMessage({ applicationId, elapsedSeconds, balance, reason }) {
        return [
            '❌ APPLICATION REJECTED!',
            '',
            'Your github student developer pack has been rejected!',
            '',
            `- Rejected in: ${Number.isFinite(elapsedSeconds) ? `${elapsedSeconds}s` : '-'}`,
            '- Credit charged: no',
            `- Balance: ${formatNumber(balance)}`,
            '',
            `⚠️ ${sanitizeInfo(reason || '-')}`
        ].join('\n')
    }

    async _sendTerminalMessage(job, payload, status) {
        if (!this._sock || !job?.chatJid) return false

        const normalized = normalizeStatus(status)
        const success = TERMINAL_SUCCESS.has(normalized)
        const applicationId = extractApplicationId(payload)
        const elapsedSeconds = extractElapsedSeconds(payload)
        const creditChargedText = extractCreditsChargedText(payload)
        const balance = await this._resolveBalance(payload)
        const reason = pickMessage(payload)

        const text = success
            ? this._buildApprovedMessage({
                applicationId,
                elapsedSeconds,
                creditChargedText,
                balance
            })
            : this._buildRejectedMessage({
                applicationId,
                elapsedSeconds,
                balance,
                reason
            })

        try {
            await sleep(UPDATE_DELAY_MS)
            await this._sock.sendMessage(job.chatJid, { text })
            return true
        } catch (err) {
            logger.warn(`[GHS] gagal kirim terminal update: ${clean(err?.message || err)}`)
            return false
        }
    }

    async _sendProgressMessage({ chatJid, email, statusText, infoText }) {
        if (!this._sock || !chatJid) return false

        const text = [
            '*VERIFIKASI GITHUB STUDENT*',
            '',
            `- Email: ${clean(email)}`,
            `- Status: ${clean(statusText) || 'diproses...'}`,
            `- Info: ${clean(infoText) || '-'}`
        ].join('\n')

        try {
            await sleep(UPDATE_DELAY_MS)
            await this._sock.sendMessage(chatJid, { text })
            return true
        } catch (err) {
            logger.warn(`[GHS] gagal kirim progress update: ${clean(err?.message || err)}`)
            return false
        }
    }
}

const ghsVerifyService = new GhsVerifyService()
export default ghsVerifyService
