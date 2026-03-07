import axios from 'axios'

const MAX_RESULTS = 15
const REQUEST_TIMEOUT = 45000
const SEARCH_ENDPOINT = 'https://gql.tokopedia.com/graphql/SearchProductV5Query'

const SEARCH_QUERY = `
query SearchProductV5Query($params:String!){
  searchProductV5(params:$params){
    header{
      totalData
      responseCode
    }
    data{
      products{
        name
        url
        rating
        wishlist
        mediaURL{
          image
          image300
        }
        price{
          text
          number
        }
        shop{
          name
          city
        }
      }
    }
  }
}
`

const cleanText = (value) => String(value || '')
    .replace(/\s+/g, ' ')
    .trim()

const normalizeUrl = (value) => {
    const raw = cleanText(value)
    if (!raw) return null
    if (raw.startsWith('//')) return `https:${raw}`
    if (!/^https?:\/\//i.test(raw)) return null
    return raw
}

const normalizeQuery = (rawInput) => {
    const text = cleanText(rawInput)
    if (!text) return ''

    if (/^https?:\/\//i.test(text)) {
        try {
            const url = new URL(text)
            if (/tokopedia\.com$/i.test(url.hostname) && url.pathname.includes('/search')) {
                const q = cleanText(url.searchParams.get('q'))
                if (q) return q
            }
        } catch {
            // fallback to raw text
        }
    }

    return text
}

const buildSearchParams = (query) => {
    const params = new URLSearchParams()
    params.set('q', query)
    params.set('st', 'product')
    params.set('page', '1')
    params.set('ob', '23')
    params.set('source', 'search')
    params.set('device', 'desktop')
    return params.toString()
}

const toDisplayItem = (item = {}) => {
    const title = cleanText(item.name) || '-'
    const link = normalizeUrl(item.url)
    if (!link) return null

    const price = cleanText(item?.price?.text) || '-'
    const shop = cleanText(item?.shop?.name) || '-'
    const city = cleanText(item?.shop?.city) || '-'
    const rating = cleanText(item.rating) || '-'
    const image = normalizeUrl(item?.mediaURL?.image300) || normalizeUrl(item?.mediaURL?.image)

    return {
        title,
        link,
        price,
        shop,
        city,
        rating,
        image
    }
}

const formatItem = (item, index) =>
    `${index + 1}. ${item.title}\n` +
    `× Harga: ${item.price}\n` +
    `× Toko: ${item.shop} (${item.city})\n` +
    `× Rating: ${item.rating}\n` +
    `× Link: ${item.link}`

const fetchTokopedia = async (query) => {
    const params = buildSearchParams(query)
    const { data, status } = await axios.post(
        SEARCH_ENDPOINT,
        {
            query: SEARCH_QUERY,
            variables: { params }
        },
        {
            timeout: REQUEST_TIMEOUT,
            validateStatus: () => true,
            headers: {
                'content-type': 'application/json',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'x-device': 'desktop',
                'referer': `https://www.tokopedia.com/search?st=product&q=${encodeURIComponent(query)}`
            }
        }
    )

    if (status !== 200) {
        throw new Error(`HTTP ${status}`)
    }

    if (Array.isArray(data?.errors) && data.errors.length) {
        const firstErr = cleanText(data.errors[0]?.message)
        throw new Error(firstErr || 'GraphQL error')
    }

    const rawItems = Array.isArray(data?.data?.searchProductV5?.data?.products)
        ? data.data.searchProductV5.data.products
        : []

    const seen = new Set()
    const rows = []

    for (const raw of rawItems) {
        const item = toDisplayItem(raw)
        if (!item) continue
        if (seen.has(item.link)) continue
        seen.add(item.link)
        rows.push(item)
        if (rows.length >= MAX_RESULTS) break
    }

    return rows
}

export default {
    name: 'tokopedia',
    aliases: ['toko', 'tokped'],
    description: 'Cari produk di tokopedia',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const q = normalizeQuery(text)

        if (!q) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} pc gaming`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const rows = await fetchTokopedia(q)

            if (!rows.length) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: `❌ Tidak ditemukan hasil tokopedia untuk: ${q}`
                }, { quoted: msg })
            }

            const caption = rows
                .map((item, index) => formatItem(item, index))
                .join('\n\n')

            const firstImage = rows[0]?.image
            if (firstImage) {
                await sock.sendMessage(jid, {
                    image: { url: firstImage },
                    caption: `\`\`\`${caption}\`\`\``
                }, { quoted: msg })
            } else {
                await sock.sendMessage(jid, {
                    text: `\`\`\`${caption}\`\`\``
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
