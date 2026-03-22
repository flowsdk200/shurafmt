import chalk from 'chalk'
import { normalizeJid } from './jid.js'

const LOG_TO_FILE = process.env.LOG_TO_FILE === 'true'

const saveLog = async (type, msg) => {
    if (!LOG_TO_FILE) return
    try {
        const fs = await import('fs')
        const path = await import('path')
        const logDir = path.default.resolve('./logs')
        const logFile = path.default.join(logDir, 'error.log')
        if (!fs.default.existsSync(logDir)) fs.default.mkdirSync(logDir, { recursive: true })
        const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0]
        fs.default.appendFileSync(logFile, `[${timestamp}] [${type}] ${msg}\n`)
    } catch {}
}

const formatWibTime = () => {
    const parts = new Intl.DateTimeFormat('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZone: 'Asia/Jakarta'
    }).formatToParts(new Date())

    const get = (type) => parts.find((p) => p.type === type)?.value || '00'
    return `${get('hour')}:${get('minute')}:${get('second')}`
}

const renderSystemLog = (level, msg, levelColor) => {
    const time = chalk.hex('#7f8c8d')(`${formatWibTime()} WIB`)
    const lvl = levelColor(level.padEnd(5, ' '))
    const text = chalk.whiteBright(msg)
    console.log(`${time} | ${lvl} | ${text}`)
}

const logger = {
    info: (msg) => renderSystemLog('INFO', msg, chalk.cyan.bold),
    ready: (msg) => renderSystemLog('READY', msg, chalk.greenBright.bold),
    warn: (msg) => { renderSystemLog('WARN', msg, chalk.yellow.bold); saveLog('WARN', msg) },
    error: (msg) => { renderSystemLog('ERROR', msg, chalk.redBright.bold); saveLog('ERROR', msg) },
    chat: (senderName, message, type, meta = {}) => {
        const headerStyle = chalk.whiteBright(chalk.bgHex('#1a1a2e').bold('╭───[ MESSAGE LOG ]'))
        const footerStyle = chalk.whiteBright(chalk.bgHex('#1a1a2e')('╰─────────────────────────────────────────────────'))
        const messageStyle = chalk.hex('#00ffea').bold
        const senderStyle = chalk.hex('#f9ca24').bold
        const jidStyle = chalk.hex('#e056fd').bold
        const groupStyle = chalk.hex('#ff6b6b').bold
        const metaStyle = chalk.hex('#20bf6b').bold
        const typeStyle = chalk.hex('#ff9f43').bold

        const senderJid = String(meta.senderJid || '-')
        const rawChatJid = String(meta.chatJid || '-')
        const isGroup = rawChatJid.endsWith('@g.us')
        let chatJid = rawChatJid
        if (!isGroup && rawChatJid.endsWith('@lid')) {
            chatJid = normalizeJid(rawChatJid) || senderJid || rawChatJid
        }
        const pushName = senderName || senderJid.split('@')[0] || 'Unknown'
        const msgText = message || '[Media]'
        const msgType = String(type || 'unknown')
        const phoneNumber = senderJid.split('@')[0].split(':')[0]
        const isLidUser = senderJid.endsWith('@lid')
        const formattedNumber = isLidUser
            ? `LID:${phoneNumber.slice(-10)}`
            : phoneNumber.replace(/(\d{4})(\d{4})(\d+)/, '$1-$2-$3')

        const timestamp = new Date().toLocaleString('id-ID', {
            day: '2-digit',
            month: 'long',
            year: 'numeric',
            timeZone: 'Asia/Jakarta'
        })
        const time = new Date().toLocaleString('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
            timeZone: 'Asia/Jakarta'
        })

        const logEntries = [
            headerStyle,
            messageStyle(`• Message : ${msgText}`),
            senderStyle(`• Sender  : ${pushName}`),
            groupStyle(`• Chat    : ${chatJid}`),
            typeStyle(`• Type    : ${isGroup ? 'group message' : 'private message'}`),
            metaStyle(`• Time    : ${timestamp} ${time}`),
            footerStyle,
        ]

        console.log(logEntries.join('\n'))
        console.log()
    },
}

export default logger

const formatBytes = (bytes) => {
    if (!bytes) return '0 B'
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(1024))
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`
}

const humanDuration = (ms) => {
    const s = Math.floor(ms / 1000)
    const m = Math.floor(s / 60)
    const h = Math.floor(m / 60)
    if (h) return `${h}h ${m % 60}m ${s % 60}s`
    if (m) return `${m}m ${s % 60}s`
    return `${s}s`
}

const ucFirst = (str) => str ? str.charAt(0).toUpperCase() + str.slice(1) : ''

const truncate = (str, max = 100) => str?.length > max ? str.slice(0, max) + '...' : str

const randomOf = (...items) => items[Math.floor(Math.random() * items.length)]

export { formatBytes, humanDuration, ucFirst, truncate, randomOf }
