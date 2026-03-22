import axios from 'axios'

const SEARCH_API = 'https://registry.npmjs.org/-/v1/search'
const PROFILE_BASE = 'https://www.npmjs.com'
const REQUEST_TIMEOUT = 30000
const PAGE_SIZE = 250

const PROFILE_HEADERS = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    'upgrade-insecure-requests': '1'
}

const REQUIRED_FIELDS = [
    'username',
    'profileUrl',
    'avatarUrl',
    'scopeType',
    'scopeId',
    'createdAt',
    'updatedAt',
    'packageCount',
    'weeklyDownloads',
    'monthlyDownloads',
    'dependents',
    'latestPackageName',
    'latestPackageVersion',
    'latestPackageUpdatedAt',
    'topWeeklyPackageName',
    'topWeeklyPackageDownloads',
    'topMonthlyPackageName',
    'topMonthlyPackageDownloads',
    'maintainerCount'
]

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim()

const toCompact = (value) => {
    const n = Number(value || 0)
    if (!Number.isFinite(n)) return '0'
    const abs = Math.abs(n)
    if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`
    if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
    if (abs >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`
    return String(Math.floor(n))
}

const toDate = (value) => {
    const raw = cleanText(value)
    if (!raw) return ''
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) return raw
    return d.toLocaleString('id-ID', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Jakarta'
    })
}

const toPercent = (value) => {
    const n = Number(value)
    if (!Number.isFinite(n)) return ''
    return `${(n * 100).toFixed(2).replace(/\.00$/, '')}%`
}

const asDateMs = (value) => {
    const d = new Date(String(value || ''))
    const ms = d.getTime()
    return Number.isFinite(ms) ? ms : 0
}

const normalizeTarget = (input) => {
    const raw = cleanText(input)
    if (!raw) return ''

    let candidate = raw
    if (/^https?:\/\//i.test(raw)) {
        try {
            const u = new URL(raw)
            if (!/(^|\.)npmjs\.com$/i.test(u.hostname)) return ''
            const parts = u.pathname.split('/').filter(Boolean)
            if (!parts.length) return ''
            if (parts[0].startsWith('~')) candidate = parts[0].slice(1)
            else if (parts[0] === 'org' && parts[1]) candidate = parts[1]
            else candidate = parts[0]
        } catch {
            return ''
        }
    }

    candidate = candidate.replace(/^~+/, '').replace(/^@+/, '')
    candidate = candidate.split(/[/?#]/)[0]
    candidate = cleanText(candidate).replace(/\s+/g, '')
    if (!/^[a-z0-9][a-z0-9-]{0,214}$/i.test(candidate)) return ''
    return candidate.toLowerCase()
}

const extractObjectAfterMarker = (source, marker) => {
    const text = String(source || '')
    const markerIdx = text.indexOf(marker)
    if (markerIdx < 0) return ''

    const part = text.slice(markerIdx + marker.length)
    const start = part.indexOf('{')
    if (start < 0) return ''

    let depth = 0
    let inString = false
    let escaped = false

    for (let i = start; i < part.length; i += 1) {
        const ch = part[i]

        if (inString) {
            if (escaped) {
                escaped = false
                continue
            }
            if (ch === '\\') {
                escaped = true
                continue
            }
            if (ch === '"') inString = false
            continue
        }

        if (ch === '"') {
            inString = true
            continue
        }
        if (ch === '{') depth += 1
        if (ch === '}') {
            depth -= 1
            if (depth === 0) return part.slice(start, i + 1)
        }
    }

    return ''
}

const normalizeAvatarUrl = (value) => {
    const raw = cleanText(value)
    if (!raw) return ''
    if (/^https?:\/\//i.test(raw)) return raw
    if (raw.startsWith('/')) return `${PROFILE_BASE}${raw}`
    return `${PROFILE_BASE}/${raw.replace(/^\/+/, '')}`
}

const decodeBase64Url = (raw) => {
    const text = cleanText(raw)
    if (!text) return ''
    const normalized = text.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    try {
        return Buffer.from(padded, 'base64').toString('utf8')
    } catch {
        return ''
    }
}

const resolveNpmAvatarUrl = (value) => {
    const raw = normalizeAvatarUrl(value)
    if (!raw) return ''
    const m = raw.match(/\/npm-avatar\/([^/?#]+)/i)
    if (!m?.[1]) return raw

    const parts = String(m[1]).split('.')
    if (parts.length < 2) return raw
    const payload = decodeBase64Url(parts[1])
    if (!payload) return raw
    try {
        const parsed = JSON.parse(payload)
        const direct = cleanText(parsed?.avatarURL || parsed?.avatarUrl || '')
        if (/^https?:\/\//i.test(direct)) return direct
    } catch {
        // ignore decode error and use original url
    }
    return raw
}

const parseContextFromHtml = (html) => {
    const blocks = Array.from(String(html || '').matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)).map((m) => String(m[1] || ''))
    const targetBlock = blocks.find((block) => block.includes('window.__context__'))
    if (!targetBlock) throw new Error('Context npm (__context__) tidak ditemukan')

    const rawObject = extractObjectAfterMarker(targetBlock, 'window.__context__ = ')
    if (!rawObject) throw new Error('Gagal parse object __context__')

    try {
        return JSON.parse(rawObject)
    } catch {
        throw new Error('JSON __context__ tidak valid')
    }
}

const fetchProfileContext = async (username) => {
    const profileUrl = `${PROFILE_BASE}/~${encodeURIComponent(username)}`
    const { data, status } = await axios.get(profileUrl, {
        timeout: REQUEST_TIMEOUT,
        headers: PROFILE_HEADERS,
        validateStatus: () => true,
        maxRedirects: 5
    })

    if (status !== 200) throw new Error(`NPM profile HTTP ${status}`)
    const ctx = parseContextFromHtml(String(data || ''))
    const scope = ctx?.context?.scope || {}
    const packages = Array.isArray(ctx?.context?.packages?.objects) ? ctx.context.packages.objects : []
    const total = Number(ctx?.context?.packages?.total || packages.length || 0)

    return { scope, packages, total, profileUrl }
}

const requestSearch = async (username, from) => {
    const { data, status } = await axios.get(SEARCH_API, {
        timeout: REQUEST_TIMEOUT,
        params: {
            text: `maintainer:${username}`,
            size: PAGE_SIZE,
            from
        },
        headers: {
            accept: 'application/json',
            'user-agent': PROFILE_HEADERS['user-agent']
        },
        validateStatus: () => true
    })

    if (status !== 200) throw new Error(`NPM search HTTP ${status}`)
    return data || {}
}

const collectSearchRows = async (username) => {
    const all = []
    let from = 0
    let total = null

    while (true) {
        const data = await requestSearch(username, from)
        const objects = Array.isArray(data?.objects) ? data.objects : []
        if (total === null) total = Number(data?.total || 0)
        if (!objects.length) break

        const filtered = objects.filter((obj) => {
            const pkg = obj?.package || {}
            const publisherUser = cleanText(pkg?.publisher?.username).toLowerCase()
            if (publisherUser === username) return true
            const maintainers = Array.isArray(pkg?.maintainers) ? pkg.maintainers : []
            return maintainers.some((m) => cleanText(m?.username).toLowerCase() === username)
        })

        all.push(...filtered)
        from += PAGE_SIZE
        if (objects.length < PAGE_SIZE) break
        if (Number.isFinite(total) && from >= total) break
        if (from > 5000) break
    }

    return all
}

const aggregate = (username, profileData, searchRows) => {
    const scope = profileData?.scope || {}
    const scopeParent = scope?.parent || {}
    const scopeResource = scope?.resource || {}
    const pkgContextRows = Array.isArray(profileData?.packages) ? profileData.packages : []
    const rows = Array.isArray(searchRows) ? searchRows : []

    if (!pkgContextRows.length && !rows.length) {
        throw new Error('User npm tidak punya metadata package publik')
    }

    const rowByName = new Map()
    for (const row of rows) {
        const name = cleanText(row?.package?.name)
        if (name) rowByName.set(name, row)
    }

    const allNames = new Set([
        ...pkgContextRows.map((p) => cleanText(p?.name)).filter(Boolean),
        ...rows.map((r) => cleanText(r?.package?.name)).filter(Boolean)
    ])

    const packageCount = Number(profileData?.total || allNames.size)
    const weeklyDownloads = rows.reduce((sum, row) => sum + Number(row?.downloads?.weekly || 0), 0)
    const monthlyDownloads = rows.reduce((sum, row) => sum + Number(row?.downloads?.monthly || 0), 0)
    const dependents = rows.reduce((sum, row) => sum + Number(row?.dependents || 0), 0)

    const mergedRows = Array.from(allNames).map((name) => {
        const ctxPkg = pkgContextRows.find((p) => cleanText(p?.name) === name) || null
        const searchPkg = rowByName.get(name) || null
        return { name, ctxPkg, searchPkg }
    })

    const latest = mergedRows
        .slice()
        .sort((a, b) => {
            const aMs = asDateMs(a?.ctxPkg?.updated?.ts ? new Date(Number(a.ctxPkg.updated.ts)).toISOString() : a?.searchPkg?.updated)
            const bMs = asDateMs(b?.ctxPkg?.updated?.ts ? new Date(Number(b.ctxPkg.updated.ts)).toISOString() : b?.searchPkg?.updated)
            return bMs - aMs
        })[0]

    const topWeekly = mergedRows
        .slice()
        .sort((a, b) => Number(b?.searchPkg?.downloads?.weekly || 0) - Number(a?.searchPkg?.downloads?.weekly || 0))[0]

    const topMonthly = mergedRows
        .slice()
        .sort((a, b) => Number(b?.searchPkg?.downloads?.monthly || 0) - Number(a?.searchPkg?.downloads?.monthly || 0))[0]

    const oldestCtx = pkgContextRows.slice().sort((a, b) => Number(a?.created?.ts || 0) - Number(b?.created?.ts || 0))[0]
    const newestCtx = pkgContextRows.slice().sort((a, b) => Number(b?.created?.ts || 0) - Number(a?.created?.ts || 0))[0]

    const maintainers = new Set()
    for (const p of pkgContextRows) {
        const ms = Array.isArray(p?.maintainers) ? p.maintainers : []
        for (const m of ms) {
            const u = cleanText(m).toLowerCase()
            if (u) maintainers.add(u)
        }
    }
    for (const row of rows) {
        const ms = Array.isArray(row?.package?.maintainers) ? row.package.maintainers : []
        for (const m of ms) {
            const u = cleanText(m?.username).toLowerCase()
            if (u) maintainers.add(u)
        }
    }

    const scopes = new Set()
    for (const name of allNames) {
        if (name.startsWith('@') && name.includes('/')) scopes.add(name.slice(1).split('/')[0].toLowerCase())
    }

    const scoreQualityAvg = rows.length ? rows.reduce((n, r) => n + Number(r?.score?.detail?.quality || 0), 0) / rows.length : null
    const scorePopularityAvg = rows.length ? rows.reduce((n, r) => n + Number(r?.score?.detail?.popularity || 0), 0) / rows.length : null
    const scoreMaintenanceAvg = rows.length ? rows.reduce((n, r) => n + Number(r?.score?.detail?.maintenance || 0), 0) / rows.length : null
    const maxSearchScore = rows.length ? rows.reduce((n, r) => Math.max(n, Number(r?.searchScore || 0)), 0) : null

    const highImpactCount = pkgContextRows.filter((p) => p?.is_high_impact === true).length
    const tfaRequiredCount = pkgContextRows.filter((p) => p?.publish_requires_tfa === true).length
    const privateCount = pkgContextRows.filter((p) => p?.private === true).length
    const frozenCount = pkgContextRows.filter((p) => cleanText(p?.freeze_status)).length

    const latestSearchPkg = latest?.searchPkg?.package || {}
    const latestCtxPkg = latest?.ctxPkg || {}
    const topWeeklySearchPkg = topWeekly?.searchPkg?.package || {}
    const topMonthlySearchPkg = topMonthly?.searchPkg?.package || {}

    const avatarUrl = resolveNpmAvatarUrl(
        scopeParent?.avatars?.large || scopeParent?.avatars?.medium || scopeParent?.avatars?.small
    )

    const createdAt = cleanText(scope?.created)
    const updatedAt = cleanText(scope?.updated)

    const result = {
        username,
        profileUrl: profileData.profileUrl,
        avatarUrl,
        scopeType: cleanText(scope?.type),
        scopeId: Number(scope?.id),
        createdAt,
        updatedAt,
        packageCount,
        weeklyDownloads,
        monthlyDownloads,
        dependents,
        maintainerCount: maintainers.size || 1,
        maintainers: [...maintainers].sort(),
        scopeCount: scopes.size,
        scopes: [...scopes].sort(),
        github: cleanText(scopeResource?.github || scopeParent?.resource?.github),
        fullname: cleanText(scopeResource?.fullname || scopeParent?.resource?.fullname),
        latestPackageName: cleanText(latestCtxPkg?.name || latestSearchPkg?.name),
        latestPackageVersion: cleanText(latestCtxPkg?.version || latestSearchPkg?.version),
        latestPackageUpdatedAt: cleanText(
            latestCtxPkg?.lastPublish?.time ||
            latestSearchPkg?.date ||
            latest?.searchPkg?.updated ||
            ''
        ),
        latestPackageDescription: cleanText(latestCtxPkg?.description || latestSearchPkg?.description),
        latestPackageNpmLink: cleanText(latestSearchPkg?.links?.npm || (latestCtxPkg?.name ? `${PROFILE_BASE}/package/${encodeURIComponent(latestCtxPkg.name)}` : '')),
        topWeeklyPackageName: cleanText(topWeekly?.name || topWeeklySearchPkg?.name),
        topWeeklyPackageDownloads: Number(topWeekly?.searchPkg?.downloads?.weekly || 0),
        topMonthlyPackageName: cleanText(topMonthly?.name || topMonthlySearchPkg?.name),
        topMonthlyPackageDownloads: Number(topMonthly?.searchPkg?.downloads?.monthly || 0),
        oldestPackageName: cleanText(oldestCtx?.name),
        oldestPackageCreatedAt: cleanText(oldestCtx?.created?.ts ? new Date(Number(oldestCtx.created.ts)).toISOString() : ''),
        newestPackageName: cleanText(newestCtx?.name),
        newestPackageCreatedAt: cleanText(newestCtx?.created?.ts ? new Date(Number(newestCtx.created.ts)).toISOString() : ''),
        highImpactCount,
        tfaRequiredCount,
        privateCount,
        frozenCount,
        avgQuality: Number.isFinite(scoreQualityAvg) ? scoreQualityAvg : null,
        avgPopularity: Number.isFinite(scorePopularityAvg) ? scorePopularityAvg : null,
        avgMaintenance: Number.isFinite(scoreMaintenanceAvg) ? scoreMaintenanceAvg : null,
        maxSearchScore: Number.isFinite(maxSearchScore) ? maxSearchScore : null,
        sourceProfile: profileData.profileUrl,
        sourceSearch: `${SEARCH_API}?text=maintainer:${encodeURIComponent(username)}`
    }

    for (const field of REQUIRED_FIELDS) {
        const value = result[field]
        const invalid =
            value === null ||
            value === undefined ||
            (typeof value === 'string' && !value.trim()) ||
            (typeof value === 'number' && !Number.isFinite(value))
        if (invalid) throw new Error(`Metadata tidak lengkap: ${field}`)
    }

    return result
}

const buildCaption = (m) => {
    const lines = [
        `• Username: ${m.username}`,
        `• Scope Type: ${m.scopeType}`,
        `• Scope ID: ${m.scopeId}`,
        `• Fullname: ${m.fullname || m.username}`,
        `• Github: ${m.github || m.username}`,
        `• Created: ${toDate(m.createdAt)}`,
        `• Updated: ${toDate(m.updatedAt)}`,
        `• Packages: ${toCompact(m.packageCount)}`,
        `• Weekly Downloads: ${toCompact(m.weeklyDownloads)}`,
        `• Monthly Downloads: ${toCompact(m.monthlyDownloads)}`,
        `• Dependents: ${toCompact(m.dependents)}`,
        `• Maintainers: ${toCompact(m.maintainerCount)} (${m.maintainers.join(', ')})`,
        `• Scopes: ${toCompact(m.scopeCount)} (${m.scopes.join(', ') || '-'})`,
        `• Latest Package: ${m.latestPackageName}`,
        `• Latest Version: ${m.latestPackageVersion}`,
        `• Latest Updated: ${toDate(m.latestPackageUpdatedAt)}`,
        `• Latest Desc: ${m.latestPackageDescription}`,
        `• Latest Link: ${m.latestPackageNpmLink}`,
        `• Top Weekly: ${m.topWeeklyPackageName} (${toCompact(m.topWeeklyPackageDownloads)})`,
        `• Top Monthly: ${m.topMonthlyPackageName} (${toCompact(m.topMonthlyPackageDownloads)})`,
        `• Oldest Package: ${m.oldestPackageName} (${toDate(m.oldestPackageCreatedAt)})`,
        `• Newest Package: ${m.newestPackageName} (${toDate(m.newestPackageCreatedAt)})`,
        `• High Impact: ${toCompact(m.highImpactCount)}`,
        `• Require TFA: ${toCompact(m.tfaRequiredCount)}`,
        `• Private Packages: ${toCompact(m.privateCount)}`,
        `• Frozen Packages: ${toCompact(m.frozenCount)}`,
        `• Avg Quality: ${toPercent(m.avgQuality)}`,
        `• Avg Popularity: ${toPercent(m.avgPopularity)}`,
        `• Avg Maintenance: ${toPercent(m.avgMaintenance)}`,
        `• Max Search Score: ${String(Number(m.maxSearchScore || 0).toFixed(3))}`,
        `• Profile: ${m.profileUrl}`,
        `• Source Profile: ${m.sourceProfile}`,
        `• Source Search: ${m.sourceSearch}`
    ]

    return `\`\`\`NPM STALK ${m.username.toUpperCase()}\n\n${lines.join('\n')}\`\`\``
}

export default {
    name: 'npmstalk',
    aliases: ['stalknpm', 'npmprofile', 'npms'],
    description: 'Stalk metadata lengkap akun npm (strict, no empty)',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const username = normalizeTarget(text)

        if (!username) {
            return sock.sendMessage(jid, {
                text:
                    `Contoh penggunaan:\n` +
                    `- ${prefix + command} shurainc`
            }, { quoted: msg })
        }

        await react('⏳')
        try {
            const [profileData, searchRows] = await Promise.all([
                fetchProfileContext(username),
                collectSearchRows(username)
            ])

            const meta = aggregate(username, profileData, searchRows)
            const caption = buildCaption(meta)

            try {
                await sock.sendMessage(jid, {
                    image: { url: meta.avatarUrl },
                    caption
                }, { quoted: msg })
            } catch {
                await sock.sendMessage(jid, {
                    text: caption
                }, { quoted: msg })
            }

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${err?.message}`
            }, { quoted: msg })
        }
    }
}
