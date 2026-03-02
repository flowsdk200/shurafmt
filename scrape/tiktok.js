import axios from 'axios'
import { CookieJar } from 'tough-cookie'
import { wrapper } from 'axios-cookiejar-support'
import { load } from 'cheerio'

const SEARCH_TIMEOUT = 30000
const SEARCH_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'

class MusicalDown {
    constructor() {
        const jar = new CookieJar()
        this.client = wrapper(axios.create({
            jar,
            timeout: 30000,
            headers: {
                'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
                'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'accept-language': 'id-ID,id;q=0.9',
                'upgrade-insecure-requests': '1'
            }
        }))
    }

    async #getHtml(url, options = {}) {
        try {
            const response = await this.client.get(url, {
                validateStatus: () => true,
                ...options
            })
            return response.data
        } catch (error) {
            throw new Error(`Failed to fetch ${url}: ${error.message}`)
        }
    }

    async #postHtml(url, data, headers = {}) {
        try {
            const response = await this.client.post(url, data, {
                headers: {
                    'content-type': 'application/x-www-form-urlencoded',
                    ...headers
                },
                validateStatus: () => true
            })
            return response.data
        } catch (error) {
            throw new Error(`Failed to post to ${url}: ${error.message}`)
        }
    }

    async download(tiktokUrl) {
        const homeHtml = await this.#getHtml('https://musicaldown.com/id')

        const $home = load(homeHtml)
        const form = $home('#submit-form')
        if (!form.length) throw new Error('Form not found')

        const body = new URLSearchParams()
        let urlFieldName = null

        form.find('input').each((_, el) => {
            const name = $home(el).attr('name')
            const type = $home(el).attr('type') ?? 'text'
            const value = $home(el).attr('value') ?? ''
            if (!name) return

            if (type === 'text') {
                urlFieldName = name
                body.set(name, tiktokUrl)
            } else {
                body.set(name, value)
            }
        })

        if (!urlFieldName) throw new Error('URL input field not found')

        const resultHtml = await this.#postHtml('https://musicaldown.com/id/download', body.toString(), {
            origin: 'https://musicaldown.com',
            referer: 'https://musicaldown.com/id'
        })

        const $ = load(resultHtml)

        if ($('#SlideButton').length) {
            const mp3Url = $('a.download[data-event="mp3_download_click"]').attr('href') ?? null

            let sliderData = null
            $('script').each((_, el) => {
                const m = ($(el).html() ?? '').match(/data:\s*["']([A-Za-z0-9+/=]+)["']/)
                if (m && !sliderData) {
                    try {
                        sliderData = JSON.parse(Buffer.from(m[1], 'base64').toString())
                    } catch {}
                }
            })

            const photos = []
            $('.card').each((_, card) => {
                const thumbnail = $(card).find('.card-image img').attr('src') ?? null
                const downloadUrl = $(card).find('.card-action a[href]').attr('href') ?? null
                if (thumbnail && downloadUrl) photos.push({ thumbnail, downloadUrl })
            })

            return { type: 'slideshow', mp3Url, sliderData, photos }
        }

        const author = $('.video-author b').first().text().trim() || $('.video-author').first().text().trim() || null
        const description = $('.video-desc').first().text().trim() || null
        const thumbnail = $('.bg-overlay').first().attr('style')?.match(/url\(([^)]+)\)/)?.[1] ?? null
        const avatar = $('.img-area img').first().attr('src') ?? null

        const links = []
        $('a.download[href], a[data-event][href]').each((_, el) => {
            const href = $(el).attr('href')
            const event = $(el).attr('data-event') ?? ''
            const label = $(el).text().replace(/\s+/g, ' ').trim()
            if (!href?.startsWith('http') || href.includes('/id')) return
            const src = (event + label).toLowerCase()
            const type = src.includes('mp3')
                ? 'mp3'
                : src.includes('hd')
                    ? 'mp4_hd'
                    : src.includes('watermark')
                        ? 'mp4_watermark'
                        : 'mp4'
            links.push({ label, url: href, type })
        })

        return { type: 'video', author, description, thumbnail, avatar, links }
    }
}

const searchApi = axios.create({
    timeout: SEARCH_TIMEOUT,
    headers: { 'User-Agent': SEARCH_USER_AGENT }
})

const TIKWM_TIMEOUT = 60000
const TIKWM_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const tikwmApi = axios.create({
    timeout: TIKWM_TIMEOUT,
    headers: { 'User-Agent': TIKWM_USER_AGENT }
})

async function tiktok2(url) {
    const { data } = await tikwmApi.post(
        'https://www.tikwm.com/api/',
        'url=' + encodeURIComponent(url),
        {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': TIKWM_USER_AGENT
            }
        }
    )

    if (data.code !== 0 || !data.data) {
        throw new Error(data.msg || 'Failed to fetch TikTok data')
    }

    const d = data.data
    const isSlideshow = d.images && d.images.length > 0

    if (isSlideshow) {
        return {
            type: 'photo',
            images: d.images.map((imgUrl, i) => ({
                url: imgUrl,
                thumbnail: null,
                index: i + 1
            })),
            music: {
                url: d.music,
                id: d.music_info?.id,
                title: d.music_info?.title,
                author: d.music_info?.author,
                duration: d.music_info?.duration,
                cover: d.music_info?.cover || ''
            },
            author: {
                id: d.author?.id,
                username: d.author?.unique_id,
                nickname: d.author?.nickname,
                avatar: d.author?.avatar
            },
            description: d.title,
            createTime: d.create_time,
            stats: {
                likes: d.digg_count,
                comments: d.comment_count,
                shares: d.share_count,
                plays: d.play_count,
                saves: d.collect_count
            }
        }
    }

    const videoId = String(d.id || '').trim()
    const authorUsername = String(d.author?.unique_id || '').trim()

    return {
        type: 'video',
        videoId,
        videoUrl: (authorUsername && videoId)
            ? `https://www.tiktok.com/@${authorUsername}/video/${videoId}`
            : '',
        video: {
            url: d.hdplay || d.play,
            urlHd: d.hdplay,
            urlWatermark: d.wmplay,
            cover: d.cover || d.origin_cover,
            duration: d.duration,
            width: d.width,
            height: d.height
        },
        music: {
            url: d.music,
            id: d.music_info?.id,
            title: d.music_info?.title,
            author: d.music_info?.author,
            duration: d.music_info?.duration,
            cover: d.music_info?.cover || ''
        },
        author: {
            id: d.author?.id,
            username: authorUsername,
            nickname: d.author?.nickname,
            avatar: d.author?.avatar
        },
        description: d.title,
        createTime: d.create_time,
        stats: {
            likes: d.digg_count,
            comments: d.comment_count,
            shares: d.share_count,
            plays: d.play_count,
            saves: d.collect_count
        }
    }
}

async function searchTikTok(query, limit = 10) {
    const q = String(query || '').trim()
    if (!q) throw new Error('Query pencarian kosong')

    const { data } = await searchApi.get('https://api.baguss.xyz/api/search/tiktok', {
        params: { q }
    })

    if (!data || data.status !== true || !Array.isArray(data.results)) {
        throw new Error(data?.message || data?.msg || 'Gagal mengambil hasil pencarian TikTok')
    }

    const normalized = data.results.map((item) => {
        const username = item?.author?.unique_id || item?.author?.username || ''
        const videoId = String(item?.video_id || '').trim()
        const permalink = (username && videoId)
            ? `https://www.tiktok.com/@${username}/video/${videoId}`
            : ''

        return {
            id: videoId,
            title: item?.title || '',
            duration: Number(item?.duration || 0),
            url: permalink,
            videoUrl: item?.play_url || item?.wmplay_url || '',
            audioUrl: item?.music || item?.music_info?.play || '',
            cover: item?.cover || item?.origin_cover || item?.music_info?.cover || '',
            musicId: item?.music_id || item?.music_info?.id || '',
            musicTitle: item?.music_info?.title || '',
            musicAuthor: item?.music_info?.author || '',
            author: {
                id: item?.author?.id,
                username,
                nickname: item?.author?.nickname || ''
            },
            stats: {
                plays: item?.play_count,
                likes: item?.digg_count,
                comments: item?.comment_count,
                shares: item?.share_count,
                downloads: item?.download_count
            }
        }
    })

    const lim = Math.max(1, Math.min(60, Number(limit) || 10))
    return normalized.slice(0, lim)
}

export { MusicalDown, searchTikTok, tiktok2 }
