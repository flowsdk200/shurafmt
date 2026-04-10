import axios from 'axios'
import { wrapper as axiosCookieJarWrapper } from 'axios-cookiejar-support'
import { CookieJar } from 'tough-cookie'
import { load } from 'cheerio'
import usersDb from '../database/users.js'
import logger from '../utils/logger.js'

const VERIFY_COST = 20
const UPDATE_DELAY_MS = 5000
const POLL_INTERVAL_MS = 60 * 1000
const MAX_POLL_ATTEMPTS = 20
const REQUEST_TIMEOUT_MS = 45 * 1000
const DEFAULT_UNIVERSITY = 'United College of Engineering and Research'
const DEFAULT_BROWSER_LOCATION = 'Lahore, Pakistan'
const DEFAULT_GEOLOCATION = { latitude: 31.5204, longitude: 74.3587 }
const SCHOOL_SEARCH_TERMS = [
    DEFAULT_UNIVERSITY,
    'NED University of Engineering and Technology',
    'University of the Punjab',
    'University of Lahore',
    'Indian Institute of Technology Delhi',
    'University of Mumbai',
    'Pakistan',
    'India'
]
const GITHUB_BASE = 'https://github.com'
const GITHUB_LOGIN_URL = `${GITHUB_BASE}/login`
const GITHUB_SESSION_URL = `${GITHUB_BASE}/session`
const GITHUB_SETTINGS_PROFILE_URL = `${GITHUB_BASE}/settings/profile`
const GITHUB_EDU_BENEFITS_URL = `${GITHUB_BASE}/settings/education/benefits`
const GITHUB_EDU_FORM_URL = `${GITHUB_BASE}/settings/education/developer_pack_applications/new`
const GITHUB_EDU_SUBMIT_URL = `${GITHUB_BASE}/settings/education/developer_pack_applications`
const GITHUB_EDU_SCHOOLS_SEARCH_URL = `${GITHUB_BASE}/settings/education/developer_pack_applications/schools`
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'

const clean = (value) => String(value || '').trim()
const slug = (value) => clean(value).toLowerCase()
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const stripAnsi = (value = '') => String(value || '').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
const firstNonEmpty = (...values) => values.map((x) => clean(x)).find(Boolean) || ''
const fmtSeconds = (ms) => `${Math.max(0, Math.round((Number(ms) || 0) / 1000))}s`
const fmtBalance = (jid) => Math.max(0, Number(usersDb.getCoins(jid)) || 0)

const APPROVED_MARKERS = [
    /\bapplication approved\b/i,
    /\bhas been approved\b/i,
    /\byour github student developer pack has been approved\b/i
]

const REJECTED_MARKERS = [
    /\bapplication rejected\b/i,
    /\bnot approved\b/i,
    /\bdenied\b/i,
    /\bunable to verify\b/i,
    /\bnot eligible to apply for the developer pack\b/i,
    /\bonly\s+\d+\s+day\(s\)\s+old\b/i,
    /\bminimum:\s*\d+\s*day/i,
    /\bthere was an error creating the discount request\b/i
]

const PENDING_MARKERS = [
    /\bunder review\b/i,
    /\bcurrently being reviewed\b/i,
    /\bapplication is being reviewed\b/i,
    /\bsubmitted and being reviewed\b/i,
    /\bhas been received and is currently pending review\b/i,
    /\bpending review\b/i,
    /\byour application has been submitted\b/i,
    /\bapplication has been submitted\b/i
]

const hasAnyMarker = (text = '', markers = []) => markers.some((rx) => rx.test(text))

const extractApplicationId = (raw = '') => {
    const text = clean(raw)
    if (!text) return ''
    const match = text.match(/application\s*id\s*[:#]?\s*(\d{4,})/i)
    if (match?.[1]) return match[1]
    const loose = text.match(/\b(\d{6,})\b/)
    if (loose?.[1]) return loose[1]
    return ''
}

const extractLikelyRejectReason = (raw = '') => {
    const text = clean(raw)
    if (!text) return ''

    const lines = text
        .split(/\n+/)
        .map((line) => clean(line))
        .filter(Boolean)
        .slice(0, 160)

    const reasonLine = lines.find((line) =>
        /only\s+\d+\s+day\(s\)\s+old|minimum:\s*\d+\s+day|not approved|rejected|denied|unable to verify|invalid|error|failed|cannot be reviewed|there was an error creating the discount request/i.test(line)
    )
    if (reasonLine) return reasonLine.slice(0, 260)

    return text.slice(0, 260)
}

const userFacingError = (raw = '') => {
    const text = clean(stripAnsi(raw))
    if (!text) return 'unknown error'

    if (/two-factor authentication failed|unexpected status 200 from \/sessions\/two-factor|incorrect code|incorrect one-time password|invalid two-factor/i.test(text)) {
        return 'OTP failed: Unexpected status 200 from /sessions/two-factor.'
    }

    if (/another tab or window|switched accounts|reload to refresh your session/i.test(text)) {
        return 'sesi github bentrok. tutup sesi lain lalu ulangi verifikasi.'
    }

    if (/input otp tidak ditemukan|2fa/i.test(text) && /tidak ditemukan|missing|not found|failed/i.test(text)) {
        return 'OTP failed: Unexpected status 200 from /sessions/two-factor.'
    }

    if (/login gagal|bad credentials|incorrect username or password/i.test(text)) {
        return 'login gagal. cek email/password.'
    }

    if (/id card|proof|image/i.test(text) && /kosong|empty|invalid|expired|format|mime/i.test(text)) {
        return 'file id card tidak valid. gunakan gambar yang masih aktif.'
    }

    if (/timed out|timeout|econnreset|enotfound|eai_again|network error|socket hang up/i.test(text)) {
        return 'koneksi ke github timeout. coba ulang lagi.'
    }

    return text.replace(/\s+/g, ' ').slice(0, 260)
}

const mimeFromUrl = (url = '') => {
    const v = slug(url)
    if (v.endsWith('.jpg') || v.endsWith('.jpeg')) return 'image/jpeg'
    if (v.endsWith('.png')) return 'image/png'
    if (v.endsWith('.webp')) return 'image/webp'
    return ''
}

const fileNameFromUrl = (url = '', fallback = 'id-card.jpg') => {
    try {
        const parsed = new URL(url)
        const pathname = clean(parsed.pathname)
        const last = pathname.split('/').filter(Boolean).pop()
        if (!last) return fallback
        return decodeURIComponent(last).replace(/[^\w.\-]+/g, '_')
    } catch {
        return fallback
    }
}

const toAbsoluteUrl = (currentUrl = GITHUB_BASE, next = '') => {
    try {
        return new URL(next, currentUrl).toString()
    } catch {
        return clean(next)
    }
}

const normalizeBoolString = (value) => {
    const v = slug(value)
    if (v === 'true') return 'true'
    if (v === 'false') return 'false'
    return clean(value)
}

const normalizeAxiosResponse = (response, fallbackUrl = '') => {
    const url = clean(response?.request?.res?.responseUrl || response?.headers?.location || fallbackUrl)
    const html = typeof response?.data === 'string'
        ? response.data
        : response?.data == null
            ? ''
            : String(response.data)
    return {
        status: Number(response?.status) || 0,
        url,
        html
    }
}

const collectBannerMessages = ($) => {
    const selectors = [
        '#js-flash-container .flash-error',
        '#js-flash-container .flash-warn',
        '#js-flash-container .flash',
        '.flash-error .Banner-title',
        '.flash-error',
        '.Banner--error .Banner-title',
        '.Banner--warning .Banner-title',
        '.Banner-title'
    ]

    const out = []
    for (const selector of selectors) {
        $(selector).each((_, el) => {
            const txt = clean($(el).text())
            if (txt) out.push(txt)
        })
    }

    return [...new Set(out)]
}

const parseForm = ($, baseUrl, actionMatcher = null) => {
    const forms = $('form').toArray()
    if (!forms.length) return null

    let picked = forms[0]
    if (typeof actionMatcher === 'function') {
        const matched = forms.find((el) => actionMatcher(clean($(el).attr('action') || '')))
        if (matched) picked = matched
    }

    const form = $(picked)
    const action = toAbsoluteUrl(baseUrl, clean(form.attr('action') || baseUrl))
    const method = clean(form.attr('method') || 'post').toUpperCase()
    const fields = {}

    form.find('input').each((_, el) => {
        const node = $(el)
        const name = clean(node.attr('name') || '')
        if (!name) return

        const type = slug(node.attr('type') || 'text')
        if (type === 'file') return
        if ((type === 'checkbox' || type === 'radio') && !node.attr('checked')) return
        if (type === 'submit' || type === 'button' || type === 'image' || type === 'reset') return

        const value = clean(node.attr('value') || '')
        fields[name] = value
    })

    form.find('textarea').each((_, el) => {
        const node = $(el)
        const name = clean(node.attr('name') || '')
        if (!name) return
        fields[name] = clean(node.text() || '')
    })

    form.find('select').each((_, el) => {
        const node = $(el)
        const name = clean(node.attr('name') || '')
        if (!name) return

        let selected = node.find('option[selected]').first()
        if (!selected.length) selected = node.find('option').first()
        if (!selected.length) return

        const value = clean(selected.attr('value') || selected.text() || '')
        fields[name] = value
    })

    let submitName = ''
    let submitValue = ''
    form.find('button[type="submit"],input[type="submit"]').each((_, el) => {
        if (submitName) return
        const node = $(el)
        submitName = clean(node.attr('name') || '')
        submitValue = clean(node.attr('value') || node.text() || '')
    })

    return {
        action,
        method,
        fields,
        submitName,
        submitValue,
        formVariant: clean(fields['dev_pack_form[form_variant]'] || '')
    }
}

const parseSchoolSearchResults = (html = '') => {
    const $ = load(html || '')
    const nodes = $('div[data-selected-school-id]').toArray()
    if (!nodes.length) return []

    return nodes.map((el) => {
        const node = $(el)
        const schoolName = clean(
            node.attr('data-school-name') ||
            node.attr('data-autocomplete-value') ||
            node.find('.ActionListItem-label').first().text()
        )
        return {
            schoolName,
            selectedSchoolId: clean(node.attr('data-selected-school-id') || ''),
            cameraRequired: normalizeBoolString(node.attr('data-camera-required') || 'false'),
            emailDomains: clean(node.attr('data-email-domains') || '[]'),
            overrideDistanceLimit: normalizeBoolString(node.attr('data-override-distance-limit') || 'false'),
            userTooFarFromSchool: normalizeBoolString(node.attr('data-user-too-far-from-school') || 'false'),
            twoFactorRequired: normalizeBoolString(node.attr('data-two-factor-required') || 'false'),
            userHasEmailForSchool: normalizeBoolString(node.attr('data-user-has-email-for-school') || 'false')
        }
    }).filter((item) => item.selectedSchoolId && item.schoolName)
}

const parseView = ({ html = '', url = '' }) => {
    const $ = load(html || '')
    const text = clean(($('body').text() || $.root().text() || '').replace(/\s+/g, ' '))
    const banners = collectBannerMessages($)
    const bannerText = clean(banners.join(' | '))
    const reason = firstNonEmpty(bannerText, extractLikelyRejectReason(text))

    const hasLoginInput = $('input[name="login"]').length > 0
    const hasOtpInput = $('input[name="app_otp"], input[name="otp"]').length > 0

    const form = parseForm($, url, (action) => action.includes('/settings/education/developer_pack_applications'))
    const formVariant = clean(form?.formVariant || '')
    const hasPhotoProofField = Boolean(form?.fields?.['dev_pack_form[photo_proof]'] !== undefined)
    const hasFarProofField = Boolean(form?.fields?.['dev_pack_form[far_from_campus_proof]'] !== undefined)
    const hasInitialForm = Boolean(
        form?.fields?.['dev_pack_form[application_type]'] !== undefined &&
        form?.fields?.['dev_pack_form[school_name]'] !== undefined
    )
    const hasStartApplication = /start an application/i.test(text)
    const isInitialFormLike = (
        formVariant === 'initial_form' ||
        (hasInitialForm && !hasPhotoProofField && !hasFarProofField)
    )
    const applicationId = extractApplicationId(`${text}\n${bannerText}`)

    const scanText = `${text}\n${bannerText}\n${String(html || '')}`
    let state = 'unknown'
    if (url.includes('/sessions/two-factor') || hasOtpInput) state = 'otp_required'
    else if (url.includes('/login') || hasLoginInput) state = 'auth_required'
    else if (hasAnyMarker(scanText, APPROVED_MARKERS)) state = 'approved'
    else if (hasAnyMarker(scanText, REJECTED_MARKERS)) state = 'rejected'
    else if (hasAnyMarker(scanText, PENDING_MARKERS)) state = 'pending'

    return {
        state,
        reason,
        url,
        form,
        formVariant,
        hasPhotoProofField,
        hasFarProofField,
        hasInitialForm,
        hasStartApplication,
        isInitialFormLike,
        applicationId,
        rawText: text
    }
}

class GhsWebVerifyService {
    constructor() {
        this._activeJobs = new Map()
    }

    getVerificationCost() {
        return VERIFY_COST
    }

    hasActiveJobForUser(jid) {
        const key = clean(jid)
        if (!key) return false
        return this._activeJobs.has(key)
    }

    async _sendProgress({ sock, chatJid, email, statusText, infoText }) {
        if (!sock || !chatJid) return false
        const text = [
            '*VERIFIKASI GITHUB STUDENT*',
            '',
            `- Email: ${clean(email)}`,
            `- Status: ${clean(statusText) || '-'}`,
            `- Info: ${clean(infoText) || '-'}`
        ].join('\n')
        try {
            await sleep(UPDATE_DELAY_MS)
            await sock.sendMessage(chatJid, { text })
            return true
        } catch (err) {
            logger.warn(`[GHS-WEB] gagal kirim progress: ${clean(err?.message || err)}`)
            return false
        }
    }

    async _sendApproved({ sock, chatJid, elapsedMs, charged, balance, applicationId = '' }) {
        const text = [
            '🎉 APPLICATION APPROVED!',
            '',
            'Your github student developer pack has been approved!',
            '',
            `- Application ID: ${clean(applicationId) || '-'}`,
            `- Verified in: ${fmtSeconds(elapsedMs)}`,
            `- Credit charged: ${charged ? VERIFY_COST : 'no'}`,
            `- Balance: ${Math.max(0, Number(balance) || 0)}`,
            '',
            '🌟 Congratulations! your benefits will become available within 72 hours.'
        ].join('\n')
        await sleep(UPDATE_DELAY_MS)
        await sock.sendMessage(chatJid, { text })
    }

    async _sendRejected({ sock, chatJid, elapsedMs, balance, reason, applicationId = '' }) {
        const text = [
            '❌ APPLICATION REJECTED!',
            '',
            'Your github student developer pack has been rejected!',
            '',
            `- Application ID: ${clean(applicationId) || '-'}`,
            `- Rejected in: ${fmtSeconds(elapsedMs)}`,
            '- Credit charged: no',
            `- Balance: ${Math.max(0, Number(balance) || 0)}`,
            '',
            `⚠️ ${clean(reason) || '-'}`
        ].join('\n')
        await sleep(UPDATE_DELAY_MS)
        await sock.sendMessage(chatJid, { text })
    }

    async _sendPendingReview({ sock, chatJid, elapsedMs, balance, applicationId = '' }) {
        const text = [
            '⏳ APPLICATION UNDER REVIEW',
            '',
            'Your github student developer pack has been submitted and is under review.',
            '',
            `- Application ID: ${clean(applicationId) || '-'}`,
            `- Submitted in: ${fmtSeconds(elapsedMs)}`,
            '- Credit charged: pending (charged only on approval)',
            `- Balance: ${Math.max(0, Number(balance) || 0)}`,
            '',
            'Status masih pending/review. bot akan lanjut cek otomatis tiap 1 menit.'
        ].join('\n')
        await sleep(UPDATE_DELAY_MS)
        await sock.sendMessage(chatJid, { text })
    }

    _createSession() {
        const jar = new CookieJar()
        const client = axiosCookieJarWrapper(axios.create({
            jar,
            withCredentials: true,
            timeout: REQUEST_TIMEOUT_MS,
            maxRedirects: 10,
            validateStatus: () => true,
            headers: {
                'User-Agent': USER_AGENT,
                'Accept-Language': 'en-US,en;q=0.9',
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
        }))

        return { jar, client }
    }

    async _get(session, url, { referer = '', headers = {} } = {}) {
        const mergedHeaders = {
            ...(referer ? { Referer: referer } : {}),
            ...headers
        }
        const response = await session.client.get(url, { headers: mergedHeaders })
        return normalizeAxiosResponse(response, url)
    }

    async _postForm(session, url, fields, {
        referer = '',
        turbo = true,
        headers = {}
    } = {}) {
        const body = new URLSearchParams()
        for (const [key, value] of Object.entries(fields || {})) {
            if (!clean(key)) continue
            if (value === undefined || value === null) continue
            body.append(key, String(value))
        }

        const mergedHeaders = {
            Accept: turbo
                ? 'text/vnd.turbo-stream.html, text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Content-Type': 'application/x-www-form-urlencoded',
            Origin: GITHUB_BASE,
            ...(referer ? { Referer: referer } : {}),
            ...headers
        }

        const response = await session.client.post(url, body.toString(), { headers: mergedHeaders })
        return normalizeAxiosResponse(response, url)
    }

    async _downloadProofPayload(idCardUrl, idCardFileName = 'id-card') {
        const url = clean(idCardUrl)
        if (!/^https?:\/\//i.test(url)) throw new Error('url id card tidak valid')

        const res = await fetch(url, { method: 'GET' })
        if (!res.ok) throw new Error(`gagal download id card (HTTP ${res.status})`)

        const arr = await res.arrayBuffer()
        const buffer = Buffer.from(arr)
        if (!buffer.length) throw new Error('file id card kosong')

        const contentTypeRaw = clean(res.headers.get('content-type') || '')
        const contentType = clean(contentTypeRaw.split(';')[0] || '') || mimeFromUrl(url)
        if (!/^image\//i.test(contentType)) {
            throw new Error('id card harus berupa gambar (jpg/png/webp)')
        }

        const fileName = firstNonEmpty(clean(idCardFileName), fileNameFromUrl(url), 'id-card.jpg')
        const imageData = `data:${contentType};base64,${buffer.toString('base64')}`

        return JSON.stringify({
            image: imageData,
            metadata: {
                filename: fileName,
                type: 'upload',
                mimeType: contentType,
                deviceLabel: ''
            }
        })
    }

    async _login(session, { email, password, otp }) {
        const loginPage = await this._get(session, GITHUB_LOGIN_URL)
        if (loginPage.status < 200 || loginPage.status >= 400) {
            throw new Error(`gagal membuka halaman login github (HTTP ${loginPage.status})`)
        }

        const $login = load(loginPage.html || '')
        const loginForm = parseForm($login, loginPage.url || GITHUB_LOGIN_URL, (action) => action.includes('/session'))
        if (!loginForm) throw new Error('form login github tidak ditemukan')

        const loginFields = { ...loginForm.fields }
        loginFields.login = clean(email)
        loginFields.password = clean(password)
        if (!loginFields.commit) loginFields.commit = 'Sign in'

        const loginResp = await this._postForm(session, GITHUB_SESSION_URL, loginFields, {
            referer: loginPage.url || GITHUB_LOGIN_URL,
            turbo: false
        })
        const loginView = parseView(loginResp)

        if (loginView.state === 'otp_required') {
            const $otp = load(loginResp.html || '')
            const otpForm = parseForm($otp, loginResp.url || `${GITHUB_BASE}/sessions/two-factor`, (action) => action.includes('/sessions/two-factor'))
            if (!otpForm) throw new Error('halaman 2fa terdeteksi tapi input otp tidak ditemukan')

            const otpFields = { ...otpForm.fields }
            if (otpFields.app_otp !== undefined || /app_otp/.test(loginResp.html)) {
                otpFields.app_otp = clean(otp)
            } else {
                otpFields.otp = clean(otp)
            }

            const otpResp = await this._postForm(session, otpForm.action, otpFields, {
                referer: loginResp.url || `${GITHUB_BASE}/sessions/two-factor`,
                turbo: false
            })
            const otpView = parseView(otpResp)
            const otpErr = firstNonEmpty(otpView.reason, extractLikelyRejectReason(otpResp.html))

            if (otpView.state === 'otp_required') {
                throw new Error(firstNonEmpty(otpErr, 'OTP failed: Unexpected status 200 from /sessions/two-factor.'))
            }
            if (otpView.state === 'auth_required') {
                throw new Error(firstNonEmpty(otpErr, 'login gagal. cek email/password/otp.'))
            }
        } else if (loginView.state === 'auth_required') {
            throw new Error(firstNonEmpty(loginView.reason, 'login gagal. cek email/password.'))
        }

        const profileResp = await this._get(session, GITHUB_SETTINGS_PROFILE_URL, {
            referer: GITHUB_LOGIN_URL
        })
        const profileView = parseView(profileResp)
        if (profileView.state === 'otp_required') {
            throw new Error('OTP failed: Unexpected status 200 from /sessions/two-factor.')
        }
        if (profileView.state === 'auth_required') {
            throw new Error('login gagal. cek email/password/otp.')
        }
    }

    async _fetchInitialForm(session) {
        const benefitsResp = await this._get(session, GITHUB_EDU_BENEFITS_URL, {
            referer: GITHUB_SETTINGS_PROFILE_URL
        })
        const benefitsView = parseView(benefitsResp)
        if (benefitsView.state === 'auth_required' || benefitsView.state === 'otp_required') {
            throw new Error('session login github tidak valid.')
        }

        const formResp = await this._get(session, GITHUB_EDU_FORM_URL, {
            referer: benefitsResp.url || GITHUB_EDU_BENEFITS_URL,
            headers: {
                'Turbo-Frame': 'dev-pack-form'
            }
        })

        const formView = parseView(formResp)
        if (formView.state === 'auth_required' || formView.state === 'otp_required') {
            throw new Error('session login github tidak valid.')
        }

        return {
            response: formResp,
            view: formView
        }
    }

    async _pickSchoolMetadata(session, refererUrl) {
        const preferred = slug(DEFAULT_UNIVERSITY)

        for (const term of SCHOOL_SEARCH_TERMS) {
            const resp = await this._get(
                session,
                `${GITHUB_EDU_SCHOOLS_SEARCH_URL}?q=${encodeURIComponent(clean(term))}`,
                {
                    referer: refererUrl || GITHUB_EDU_FORM_URL,
                    headers: {
                        Accept: '*/*'
                    }
                }
            )

            if (resp.status < 200 || resp.status >= 400) continue
            const list = parseSchoolSearchResults(resp.html)
            if (!list.length) continue

            const exact = list.find((item) => slug(item.schoolName) === preferred)
            if (exact) return exact
            return list[0]
        }

        return null
    }

    async _submitStep(session, form, overrides = {}, referer = '') {
        if (!form?.action) throw new Error('form aplikasi tidak ditemukan')
        const fields = { ...(form.fields || {}) }

        for (const [key, value] of Object.entries(overrides || {})) {
            if (!clean(key)) continue
            fields[key] = value
        }

        if (form.submitName && fields[form.submitName] === undefined) {
            fields[form.submitName] = form.submitValue || 'Continue'
        }

        const response = await this._postForm(session, form.action, fields, {
            referer: referer || GITHUB_EDU_FORM_URL,
            turbo: true
        })
        const view = parseView(response)
        return { response, view }
    }

    async _runApplicationSubmit(session, {
        email,
        proofPayload,
        initialForm
    }) {
        if (!initialForm?.view?.form) {
            return {
                state: initialForm?.view?.state || 'unknown',
                reason: firstNonEmpty(initialForm?.view?.reason, 'form aplikasi github student tidak ditemukan'),
                applicationId: clean(initialForm?.view?.applicationId || '')
            }
        }

        const schoolMeta = await this._pickSchoolMetadata(session, initialForm.response.url || GITHUB_EDU_FORM_URL)
        if (!schoolMeta) {
            return {
                state: 'rejected',
                reason: 'gagal menemukan sekolah untuk submit aplikasi student.',
                applicationId: ''
            }
        }

        const initialOverrides = {
            'dev_pack_form[application_type]': 'student',
            'dev_pack_form[school_name]': schoolMeta.schoolName,
            'dev_pack_form[school_email]': clean(email),
            'dev_pack_form[selected_school_id]': schoolMeta.selectedSchoolId,
            'dev_pack_form[camera_required]': schoolMeta.cameraRequired,
            'dev_pack_form[email_domains]': schoolMeta.emailDomains,
            'dev_pack_form[override_distance_limit]': schoolMeta.overrideDistanceLimit,
            'dev_pack_form[two_factor_required]': schoolMeta.twoFactorRequired,
            'dev_pack_form[user_too_far_from_school]': schoolMeta.userTooFarFromSchool,
            'dev_pack_form[new_school]': 'false',
            'dev_pack_form[location_shared]': 'true',
            'dev_pack_form[latitude]': String(DEFAULT_GEOLOCATION.latitude),
            'dev_pack_form[longitude]': String(DEFAULT_GEOLOCATION.longitude),
            'dev_pack_form[browser_location]': DEFAULT_BROWSER_LOCATION
        }
        if (!clean(initialForm.view.form.fields?.['dev_pack_form[form_variant]'])) {
            initialOverrides['dev_pack_form[form_variant]'] = 'initial_form'
        }

        let current = await this._submitStep(
            session,
            initialForm.view.form,
            initialOverrides,
            initialForm.response.url || GITHUB_EDU_FORM_URL
        )

        for (let step = 0; step < 5; step += 1) {
            const v = current.view
            if (!v) break

            if (v.state === 'approved' || v.state === 'rejected' || v.state === 'pending') {
                return {
                    state: v.state,
                    reason: v.reason,
                    applicationId: clean(v.applicationId || '')
                }
            }

            if (!v.form) break

            if (v.hasFarProofField) {
                const overrides = {
                    'dev_pack_form[far_from_campus_reason]': 'distant_course_work',
                    'dev_pack_form[other_reason_text]': firstNonEmpty(
                        clean(v.form.fields['dev_pack_form[other_reason_text]']),
                        'Distance learning'
                    ),
                    'dev_pack_form[far_from_campus_proof]': proofPayload
                }

                current = await this._submitStep(
                    session,
                    v.form,
                    overrides,
                    current.response.url || GITHUB_EDU_FORM_URL
                )
                continue
            }

            if (v.hasPhotoProofField) {
                const overrides = {
                    'dev_pack_form[proof_type]': firstNonEmpty(
                        clean(v.form.fields['dev_pack_form[proof_type]']),
                        '1. Dated school ID'
                    ),
                    'dev_pack_form[photo_proof]': proofPayload
                }

                current = await this._submitStep(
                    session,
                    v.form,
                    overrides,
                    current.response.url || GITHUB_EDU_FORM_URL
                )
                continue
            }

            if (v.isInitialFormLike) {
                return {
                    state: 'rejected',
                    reason: firstNonEmpty(v.reason, 'submit application tidak terdeteksi. halaman masih di form awal.'),
                    applicationId: clean(v.applicationId || '')
                }
            }

            break
        }

        const finalView = current?.view
        if (finalView?.state === 'approved' || finalView?.state === 'rejected' || finalView?.state === 'pending') {
            return {
                state: finalView.state,
                reason: finalView.reason,
                applicationId: clean(finalView.applicationId || '')
            }
        }

        if (
            finalView?.hasPhotoProofField ||
            finalView?.hasFarProofField ||
            finalView?.isInitialFormLike ||
            finalView?.formVariant === 'upload_proof_form' ||
            finalView?.formVariant === 'far_from_campus_proof_form'
        ) {
            return {
                state: 'rejected',
                reason: firstNonEmpty(finalView.reason, 'submit application tidak terdeteksi. halaman masih di form submit.'),
                applicationId: clean(finalView.applicationId || '')
            }
        }

        return {
            state: 'unknown',
            reason: firstNonEmpty(finalView?.reason, 'status aplikasi tidak diketahui setelah submit.'),
            applicationId: clean(finalView?.applicationId || '')
        }
    }

    async _pollFinalStatus(session, { rejectOnFormFallback = false } = {}) {
        let lastPendingApplicationId = ''

        for (let i = 0; i < MAX_POLL_ATTEMPTS; i += 1) {
            if (i > 0) await sleep(POLL_INTERVAL_MS)

            const resp = await this._get(session, GITHUB_EDU_FORM_URL, {
                referer: GITHUB_EDU_BENEFITS_URL,
                headers: {
                    'Turbo-Frame': 'dev-pack-form'
                }
            })
            const view = parseView(resp)
            logger.info(`[GHS-WEB] poll#${i + 1}: state=${view.state} variant=${view.formVariant || '-'} url=${resp.url}`)

            if (view.state === 'approved' || view.state === 'rejected') {
                return {
                    state: view.state,
                    reason: view.reason,
                    applicationId: clean(view.applicationId || lastPendingApplicationId)
                }
            }

            if (view.state === 'pending') {
                lastPendingApplicationId = clean(view.applicationId || lastPendingApplicationId)
                continue
            }

            if (view.state === 'auth_required' || view.state === 'otp_required') {
                continue
            }

            const looksLikeFormFallback = (
                view.hasPhotoProofField ||
                view.hasFarProofField ||
                view.isInitialFormLike ||
                view.formVariant === 'upload_proof_form' ||
                view.formVariant === 'far_from_campus_proof_form'
            )

            if (looksLikeFormFallback && rejectOnFormFallback) {
                return {
                    state: 'rejected',
                    reason: firstNonEmpty(view.reason, 'submit application tidak terdeteksi. halaman kembali ke form aplikasi.'),
                    applicationId: clean(view.applicationId || lastPendingApplicationId)
                }
            }
        }

        return {
            state: 'pending',
            reason: 'status masih pending/review.',
            applicationId: clean(lastPendingApplicationId)
        }
    }

    async _run(job) {
        const startedAt = Date.now()
        const userKey = clean(job.requesterJid || job.chargedUserJid || '')
        let loginPassed = false

        try {
            const session = this._createSession()
            await this._login(session, {
                email: job.email,
                password: job.password,
                otp: job.otp
            })
            loginPassed = true

            await this._sendProgress({
                sock: job.sock,
                chatJid: job.chatJid,
                email: job.email,
                statusText: 'login berhasil!',
                infoText: 'proses verifikasi github student, tunggu 5 menit.'
            })

            const proofPayload = await this._downloadProofPayload(job.idCardUrl, job.idCardFileName)
            const initialForm = await this._fetchInitialForm(session)
            let submitResult = await this._runApplicationSubmit(session, {
                email: job.email,
                proofPayload,
                initialForm
            })

            if (submitResult.state !== 'approved' && submitResult.state !== 'rejected' && submitResult.state !== 'pending') {
                submitResult = await this._pollFinalStatus(session, { rejectOnFormFallback: true })
            } else if (submitResult.state === 'pending') {
                submitResult = await this._pollFinalStatus(session, { rejectOnFormFallback: false })
            }

            const elapsedMs = Date.now() - startedAt
            const userJid = clean(job.chargedUserJid)

            if (submitResult.state === 'approved') {
                const charged = !!usersDb.deductCoins(userJid, job.coinCost)
                if (charged) usersDb.incrementGhsApproved(userJid)
                await this._sendApproved({
                    sock: job.sock,
                    chatJid: job.chatJid,
                    elapsedMs,
                    charged,
                    balance: fmtBalance(userJid),
                    applicationId: submitResult.applicationId || ''
                })
                return
            }

            if (submitResult.state === 'pending') {
                await this._sendPendingReview({
                    sock: job.sock,
                    chatJid: job.chatJid,
                    elapsedMs,
                    balance: fmtBalance(userJid),
                    applicationId: submitResult.applicationId || ''
                })
                return
            }

            usersDb.incrementGhsFailed(userJid)
            await this._sendRejected({
                sock: job.sock,
                chatJid: job.chatJid,
                elapsedMs,
                balance: fmtBalance(userJid),
                reason: userFacingError(submitResult.reason || 'verification rejected'),
                applicationId: submitResult.applicationId || ''
            })
        } catch (err) {
            const elapsedMs = Date.now() - startedAt
            const reason = userFacingError(clean(err?.message || err) || 'unknown error')

            if (!loginPassed) {
                await this._sendProgress({
                    sock: job.sock,
                    chatJid: job.chatJid,
                    email: job.email,
                    statusText: 'gagal login...',
                    infoText: reason
                }).catch(() => {})
            }

            usersDb.incrementGhsFailed(clean(job.chargedUserJid))
            await this._sendRejected({
                sock: job.sock,
                chatJid: job.chatJid,
                elapsedMs,
                balance: fmtBalance(clean(job.chargedUserJid)),
                reason,
                applicationId: ''
            }).catch(() => {})
        } finally {
            if (userKey) this._activeJobs.delete(userKey)
        }
    }

    async submitVerificationFlow({
        sock,
        chatJid,
        requesterJid,
        chargedUserJid,
        email,
        password,
        otp,
        idCardUrl,
        idCardFileName = 'id-card',
        coinCost = VERIFY_COST
    }) {
        const key = clean(requesterJid || chargedUserJid)
        if (!key) throw new Error('user key invalid')
        if (this._activeJobs.has(key)) throw new Error('masih ada proses verifikasi aktif. tunggu sampai selesai.')

        const job = {
            sock,
            chatJid: clean(chatJid),
            requesterJid: clean(requesterJid),
            chargedUserJid: clean(chargedUserJid),
            email: clean(email),
            password: clean(password),
            otp: clean(otp),
            idCardUrl: clean(idCardUrl),
            idCardFileName: clean(idCardFileName) || 'id-card',
            coinCost: Math.max(0, Number(coinCost) || VERIFY_COST)
        }

        if (!job.chatJid || !job.email || !job.password || !job.otp || !job.idCardUrl) {
            throw new Error('parameter verifikasi belum lengkap')
        }

        this._activeJobs.set(key, {
            startedAt: Date.now(),
            email: job.email
        })

        void this._run(job)
        return { ok: true }
    }
}

const ghsWebVerifyService = new GhsWebVerifyService()
export default ghsWebVerifyService
