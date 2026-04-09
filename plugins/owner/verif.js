import ghsVerifyService from '../../src/services/ghsVerifyService.js'
import config from '../../config.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const clean = (value) => String(value || '').trim()
const toMentionTag = (jid = '') => `@${String(jid || '').split('@')[0]}`
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOCAL_DASHBOARD_IMAGE = path.resolve(__dirname, '../../assets/ghs.jpg')

const getDashboardImage = () => {
    try {
        const stat = fs.statSync(LOCAL_DASHBOARD_IMAGE)
        if (stat.size > 0) return fs.readFileSync(LOCAL_DASHBOARD_IMAGE)
    } catch {}
    return config.thumb
}

const parseVerifyInput = (input = '') => {
    const parts = String(input)
        .split(',')
        .map((x) => x.trim())

    if (parts.length < 3) return null

    const email = clean(parts[0])
    const password = clean(parts[1])
    const otp = clean(parts[2])

    if (!email || !password || !otp) return null
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null

    return { email, password, otp }
}

export default {
    name: 'verif',
    aliases: ['ghs'],
    description: 'Verifikasi GHS via email,password,otp (role student)',
    ownerOnly: false,
    ignoreLimit: true,
    execute: async ({ sock, msg, text, sender, pushName, prefix, command, react, usersDb }) => {
        const jid = msg.key.remoteJid
        const parsed = parseVerifyInput(text)
        const ownerNumber = String((config.ownerNumbers || [])[0] || '').replace(/[^0-9]/g, '')
        const ownerJid = ownerNumber ? `${ownerNumber}@s.whatsapp.net` : ''
        const verifyCost = ghsVerifyService.getVerificationCost()
        const userStats = usersDb.getGhsStats(sender)
        const coins = usersDb.getCoins(sender)
        const dashboardText = [
            `*GITHUB STUDENT DEVELOPER PACK VERIFICATION*`,
            '',
            '*Your dashboard*',
            `- Users: ${toMentionTag(sender)}`,
            `- Coins: ${coins}`,
            `- Verifications: ${userStats.approved}`,
            `- Failed: ${userStats.failed}`,
            '',
            '*Example usage*',
            `- ${prefix + command} emailkamu@gmail.com, password, otp`,
            '',
            '*Requirements*',
            '- 2FA enabled (authenticator app)',
            '- Account at least 3 days old',
            `- Verification costs student → ${verifyCost} coins`,
            '',
            'Coins charged only on approval. rejected = free.'
        ].join('\n')

        if (!parsed) {
            return sock.sendMessage(jid, {
                image: getDashboardImage(),
                caption: dashboardText,
                mentions: [sender]
            }, { quoted: msg })
        }

        const reservedUser = usersDb.deductCoins(sender, verifyCost)
        if (!reservedUser) {
            const noCoinText = `coins kamu gak cukup butuh ${verifyCost} coins untuk verfikasi. chat owner ${ownerJid ? toMentionTag(ownerJid) : '-'}.`
            return sock.sendMessage(jid, {
                text: noCoinText,
                mentions: ownerJid ? [ownerJid] : []
            }, { quoted: msg })
        }

        await react('⏳')

        const initText = [
            '*VERIFIKASI GITHUB STUDENT*',
            '',
            `- Email: ${parsed.email}`,
            '- Status: sedang login...',
            '- Info: authenticating with github...'
        ].join('\n')

        try {
            await sock.sendMessage(jid, { text: initText }, { quoted: msg })
        } catch (err) {
            usersDb.addCoins(sender, verifyCost)
            throw err
        }
        await react('✅')

        void ghsVerifyService.submitVerificationFlow({
            email: parsed.email,
            password: parsed.password,
            otp: parsed.otp,
            role: 'student',
            chatJid: jid,
            requesterJid: sender,
            requesterName: clean(pushName),
            chargedUserJid: sender,
            coinCost: verifyCost,
            coinsReserved: true
        })
    }
}
