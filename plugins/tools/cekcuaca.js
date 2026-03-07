import axios from 'axios'
import config from '../../config.js'

const WEATHER_API_URL = 'https://api.weatherapi.com/v1/current.json'
const REQUEST_TIMEOUT = 30000

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim()

const getApiKey = () => cleanText(config.weatherApiKey || process.env.WEATHERAPI_KEY || '')

const normalizeIcon = (iconUrl) => {
    const raw = cleanText(iconUrl)
    if (!raw) return ''
    if (raw.startsWith('//')) return `https:${raw}`
    if (/^https?:\/\//i.test(raw)) return raw
    return ''
}

const toNum = (value) => {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
}

const fmtNum = (value, suffix = '') => {
    const n = toNum(value)
    if (n === null) return '-'
    const normalized = Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '')
    return `${normalized}${suffix}`
}

const fmtBoolDay = (value) => Number(value) === 1 ? 'Siang' : 'Malam'

const buildCaption = (payload) => {
    const location = payload?.location || {}
    const current = payload?.current || {}
    const condition = current?.condition || {}
    const air = current?.air_quality || {}

    const city = cleanText(location.name)
    const region = cleanText(location.region)
    const country = cleanText(location.country)
    const area = [city, region, country].filter(Boolean).join(', ') || '-'
    const localtime = cleanText(location.localtime) || '-'
    const lastUpdated = cleanText(current.last_updated) || '-'

    return (
        `❖ Lokasi: ${area}\n` +
        `❖ Koordinat: ${fmtNum(location.lat)}, ${fmtNum(location.lon)}\n` +
        `❖ Zona Waktu: ${cleanText(location.tz_id) || '-'}\n` +
        `❖ Waktu Lokal: ${localtime}\n` +
        `❖ Update Data: ${lastUpdated}\n\n` +
        `❖ Kondisi: ${cleanText(condition.text) || '-'}\n` +
        `❖ Status: ${fmtBoolDay(current.is_day)}\n` +
        `❖ Kode Kondisi: ${fmtNum(condition.code)}\n` +
        `❖ Suhu: ${fmtNum(current.temp_c, '°C')} / ${fmtNum(current.temp_f, '°F')}\n` +
        `❖ Terasa: ${fmtNum(current.feelslike_c, '°C')} / ${fmtNum(current.feelslike_f, '°F')}\n` +
        `❖ Windchill: ${fmtNum(current.windchill_c, '°C')} / ${fmtNum(current.windchill_f, '°F')}\n` +
        `❖ Heat Index: ${fmtNum(current.heatindex_c, '°C')} / ${fmtNum(current.heatindex_f, '°F')}\n` +
        `❖ Dew Point: ${fmtNum(current.dewpoint_c, '°C')} / ${fmtNum(current.dewpoint_f, '°F')}\n\n` +
        `❖ Angin: ${fmtNum(current.wind_kph, ' kph')} / ${fmtNum(current.wind_mph, ' mph')}\n` +
        `❖ Arah Angin: ${cleanText(current.wind_dir) || '-'} (${fmtNum(current.wind_degree, '°')})\n` +
        `❖ Gust: ${fmtNum(current.gust_kph, ' kph')} / ${fmtNum(current.gust_mph, ' mph')}\n` +
        `❖ Kelembapan: ${fmtNum(current.humidity, '%')}\n` +
        `❖ Cloud Cover: ${fmtNum(current.cloud, '%')}\n` +
        `❖ Visibilitas: ${fmtNum(current.vis_km, ' km')} / ${fmtNum(current.vis_miles, ' miles')}\n` +
        `❖ Tekanan: ${fmtNum(current.pressure_mb, ' mb')} / ${fmtNum(current.pressure_in, ' in')}\n` +
        `❖ Curah Hujan: ${fmtNum(current.precip_mm, ' mm')} / ${fmtNum(current.precip_in, ' in')}\n` +
        `❖ UV: ${fmtNum(current.uv)}\n\n` +
        `❖ AQI (US-EPA): ${fmtNum(air['us-epa-index'])}\n` +
        `❖ AQI (GB-DEFRA): ${fmtNum(air['gb-defra-index'])}\n` +
        `❖ PM2.5: ${fmtNum(air.pm2_5, ' µg/m³')}\n` +
        `❖ PM10: ${fmtNum(air.pm10, ' µg/m³')}\n` +
        `❖ CO: ${fmtNum(air.co, ' µg/m³')}\n` +
        `❖ NO2: ${fmtNum(air.no2, ' µg/m³')}\n` +
        `❖ O3: ${fmtNum(air.o3, ' µg/m³')}\n` +
        `❖ SO2: ${fmtNum(air.so2, ' µg/m³')}`
    )
}

const fetchWeather = async (apiKey, query) => {
    const response = await axios.get(WEATHER_API_URL, {
        params: {
            key: apiKey,
            q: query,
            aqi: 'yes',
            lang: 'id'
        },
        timeout: REQUEST_TIMEOUT,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Accept: 'application/json,text/plain,*/*'
        },
        validateStatus: () => true
    })

    if (response.status !== 200) {
        const message = cleanText(response?.data?.error?.message) || `HTTP ${response.status}`
        throw new Error(message)
    }

    const data = response.data
    if (!data || data?.error) {
        throw new Error(cleanText(data?.error?.message) || 'Data cuaca tidak tersedia')
    }
    if (!data.location || !data.current) {
        throw new Error('Respons cuaca tidak valid')
    }

    return data
}

export default {
    name: 'cekcuaca',
    aliases: ['cuaca', 'weather'],
    description: 'Cek cuaca real-time dari WeatherAPI',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const query = cleanText(text)

        if (!query) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} yogyakarta\n- ${prefix + command} jakarta`
            }, { quoted: msg })
        }

        const apiKey = getApiKey()
        if (!apiKey) {
            return sock.sendMessage(jid, {
                text: '❌ API key WeatherAPI belum di-set. isi `weatherApiKey` di config.js'
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const data = await fetchWeather(apiKey, query)
            const caption = buildCaption(data)
            const icon = normalizeIcon(data?.current?.condition?.icon)

            if (icon) {
                await sock.sendMessage(jid, {
                    image: { url: icon },
                    caption
                }, { quoted: msg })
            } else {
                await sock.sendMessage(jid, { text: caption }, { quoted: msg })
            }

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${cleanText(err?.message) || 'Gagal ambil cuaca'}`
            }, { quoted: msg })
        }
    }
}
