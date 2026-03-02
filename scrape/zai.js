import axios from 'axios'
import crypto from 'crypto'

class ZAi {
    constructor() {
        this.token = 'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjdjNTZjYzQ1LTk1OTYtNDVmMC04N2JmLTk2YmNiZjIwMTYxMSIsImVtYWlsIjoic2hpcm9kaXhzQGdtYWlsLmNvbSJ9.spqhtY7qxv5mVebaqcItniBdkesy8RBy3RPaXWKRu3j74h8JoSP0vY-BgmKqXt_mwsUoPSfElK15wsACZQMd2w'
        this.http = axios.create({ timeout: 90000, validateStatus: () => true })
    }

    sign(prompt, timestamp, requestId, userId) {
        const sorted = Object.entries({ timestamp: `${timestamp}`, requestId: `${requestId}`, user_id: `${userId}` })
            .sort((a, b) => a[0].localeCompare(b[0]))
            .join(',')

        const source = `${sorted}|${Buffer.from(prompt, 'utf8').toString('base64')}|${timestamp}`
        const slot = Math.floor(timestamp / (5 * 60 * 1000))
        const stage1 = crypto.createHmac('sha256', 'key-@@@@)))()((9))-xxxx&&&%%%%%').update(`${slot}`).digest('hex')
        return crypto.createHmac('sha256', stage1).update(source).digest('hex')
    }

    normalizeMessages(input, options = {}) {
        const payload = typeof input === 'string'
            ? { messages: [{ role: 'user', content: input }], ...options }
            : { ...(input || {}) }

        const messages = Array.isArray(payload.messages) ? [...payload.messages] : []
        const systemPrompt = payload.system_prompt || payload.system || ''
        if (systemPrompt && !messages.some((m) => m?.role === 'system')) {
            messages.unshift({ role: 'system', content: systemPrompt })
        }
        if (payload.user && !messages.length) messages.push({ role: 'user', content: payload.user })

        const normalized = messages
            .map((m) => {
                if (!m?.role) return null
                const text = typeof m?.content === 'string' ? m.content.trim() : ''
                if (!text) return null
                return { role: m.role, content: text }
            })
            .filter(Boolean)

        return { payload, messages: normalized }
    }

    extractSignaturePrompt(messages) {
        const users = messages.filter((m) => m.role === 'user')
        const target = users.length ? users[users.length - 1] : messages[messages.length - 1]
        if (!target) return ''
        if (typeof target.content === 'string') return target.content.trim()
        return ''
    }

    parseSSE(raw) {
        let reply = ''
        let usage = null
        let apiError = null
        const parts = []

        const events = raw.split(/\r?\n\r?\n/).map((x) => x.trim()).filter(Boolean)
        for (const event of events) {
            const data = event
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => line.startsWith('data:'))
                .map((line) => line.slice(5).trim())
                .join('\n')
                .trim()

            if (!data || data === '[DONE]') continue

            try {
                const json = JSON.parse(data)
                const d = json?.data || {}

                if (typeof d.delta_content === 'string' && d.delta_content) {
                    reply += d.delta_content
                    parts.push(d.delta_content)
                }

                if (typeof d.edit_content === 'string' && d.edit_content) {
                    if (!reply || d.edit_index === 0) {
                        reply = d.edit_content
                        parts.length = 0
                        parts.push(d.edit_content)
                    } else {
                        reply += d.edit_content
                        parts.push(d.edit_content)
                    }
                }

                if (typeof d.content === 'string' && d.content) {
                    reply += d.content
                    parts.push(d.content)
                }

                if (typeof d.message === 'string' && d.message) {
                    reply += d.message
                    parts.push(d.message)
                }

                if (d.error) apiError = d.error
                if (d.usage) usage = d.usage
            } catch {
                // Abaikan baris SSE yang tidak valid
            }
        }

        return { reply: reply.trim(), usage, apiError, parts }
    }

    async chat(input, options = {}) {
        if (!this.token) throw new Error('TOKEN wajib diisi.')

        const { payload, messages } = this.normalizeMessages(input, options)
        if (!messages.length) throw new Error('messages tidak valid.')

        const model = payload.model || 'glm-4.7'
        const stream = !!payload.stream
        const prompt = this.extractSignaturePrompt(messages)
        if (!prompt) throw new Error('signature_prompt kosong.')

        const created = Math.floor(Date.now() / 1000)
        const now = new Date()
        const timestamp = Date.now()
        const requestId = payload.requestId || crypto.randomUUID()
        const userId = payload.user_id || payload.userId || '7c56cc45-9596-45f0-87bf-96bcbf201611'
        const signature = this.sign(prompt, timestamp, requestId, userId)

        const query = new URLSearchParams({
            timestamp: `${timestamp}`,
            requestId,
            user_id: userId,
            version: '0.0.1',
            platform: 'web',
            token: this.token,
            user_agent: 'Mozilla/5.0 (Android 13; Mobile; rv:147.0) Gecko/147.0 Firefox/147.0',
            language: 'id-ID',
            languages: 'id-ID,en-US',
            timezone: 'Asia/Jakarta',
            cookie_enabled: 'true',
            screen_width: '414',
            screen_height: '897',
            screen_resolution: '414x897',
            viewport_height: '792',
            viewport_width: '414',
            viewport_size: '414x792',
            color_depth: '24',
            pixel_ratio: '2.608695652173913',
            current_url: 'https://chat.z.ai',
            pathname: '/',
            search: '',
            hash: '',
            host: 'chat.z.ai',
            hostname: 'chat.z.ai',
            protocol: 'https:',
            referrer: 'https://chat.z.ai/auth',
            title: 'Z.ai - Free AI Chatbot & Agent powered by GLM-5 & GLM-4.7',
            timezone_offset: `${-now.getTimezoneOffset()}`,
            local_time: now.toISOString(),
            utc_time: now.toUTCString(),
            is_mobile: 'true',
            is_touch: 'true',
            max_touch_points: '5',
            browser_name: 'Firefox',
            os_name: 'Android'
        }).toString()

        const res = await this.http.post(
            `https://chat.z.ai/api/v2/chat/completions?${query}&signature_timestamp=${timestamp}`,
            {
                stream: true,
                model,
                messages,
                signature_prompt: prompt,
                params: {
                    ...(payload.max_tokens != null ? { max_tokens: payload.max_tokens } : {}),
                    ...(payload.temperature != null ? { temperature: payload.temperature } : {}),
                    ...(payload.top_p != null ? { top_p: payload.top_p } : {}),
                    ...(payload.params || {})
                },
                extra: payload.extra || {},
                id: payload.id || crypto.randomUUID(),
                current_user_message_id: payload.current_user_message_id || crypto.randomUUID(),
                current_user_message_parent_id: payload.current_user_message_parent_id ?? null,
                background_tasks: payload.background_tasks || { title_generation: true, tags_generation: true },
                variables: payload.variables || {
                    '{{USER_NAME}}': 'riflowsxz',
                    '{{USER_LOCATION}}': 'Unknown',
                    '{{CURRENT_DATETIME}}': now.toISOString().replace('T', ' ').slice(0, 19),
                    '{{CURRENT_DATE}}': now.toISOString().slice(0, 10),
                    '{{CURRENT_TIME}}': now.toTimeString().slice(0, 8),
                    '{{CURRENT_WEEKDAY}}': now.toLocaleDateString('en-US', { weekday: 'long' }),
                    '{{CURRENT_TIMEZONE}}': 'Asia/Jakarta',
                    '{{USER_LANGUAGE}}': 'en-US'
                },
                features: {
                    image_generation: false,
                    web_search: false,
                    auto_web_search: false,
                    preview_mode: true,
                    flags: [],
                    enable_thinking: false,
                    vision: false,
                    ...(payload.features || {})
                },
                ...(payload.attachments ? { attachments: payload.attachments } : {})
            },
            {
                headers: {
                    Authorization: `Bearer ${this.token}`,
                    'Content-Type': 'application/json',
                    'Accept-Language': 'en-US',
                    'X-FE-Version': 'prod-fe-1.0.241',
                    'X-Signature': signature,
                    'User-Agent': 'Mozilla/5.0 (Android 13; Mobile; rv:147.0) Gecko/147.0 Firefox/147.0',
                    Origin: 'https://chat.z.ai',
                    Referer: 'https://chat.z.ai/'
                },
                responseType: 'stream'
            }
        )

        let raw = ''
        for await (const chunk of res.data) raw += chunk.toString('utf8')
        if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}: ${raw.slice(0, 400).trim()}`)

        const parsed = this.parseSSE(raw)
        if (parsed.apiError) throw new Error(parsed.apiError.detail || parsed.apiError.code || 'unknown error')

        const usage = parsed.usage || {
            prompt_tokens: Math.max(1, Math.ceil(prompt.length / 4)),
            completion_tokens: parsed.reply ? Math.ceil(parsed.reply.length / 4) : 0,
            total_tokens: Math.max(1, Math.ceil(prompt.length / 4)) + (parsed.reply ? Math.ceil(parsed.reply.length / 4) : 0)
        }

        if (!stream) {
            return {
                id: requestId,
                object: 'chat.completion',
                created,
                model,
                choices: [{ index: 0, message: { role: 'assistant', content: parsed.reply }, finish_reason: 'stop' }],
                usage
            }
        }

        const chunks = parsed.parts.map((part) => ({
            id: requestId,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [{ index: 0, delta: { content: part }, finish_reason: null }]
        }))

        chunks.push({
            id: requestId,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
        })

        return {
            object: 'text.event-stream',
            content_type: 'text/event-stream; charset=utf-8',
            data: `${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('')}data: [DONE]\n\n`,
            chunks
        }
    }

    async chatCompletions(input, options = {}) {
        return this.chat(input, options)
    }
}

export { ZAi }
