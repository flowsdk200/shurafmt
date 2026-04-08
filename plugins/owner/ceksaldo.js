import ghsVerifyService from '../../src/services/ghsVerifyService.js'
import logger from '../../src/utils/logger.js'

const asObject = (value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value
    return {}
}

const pickCredits = (payload) => {
    const root = asObject(payload)
    const data = asObject(root.data)
    const result = asObject(root.result)

    const candidates = [
        root.api_credits_available,
        data.api_credits_available,
        result.api_credits_available,
        root.credits,
        data.credits,
        result.credits,
        root.balance,
        data.balance,
        result.balance,
        root.saldo,
        data.saldo,
        result.saldo
    ]

    for (const candidate of candidates) {
        const n = Number(candidate)
        if (Number.isFinite(n)) return n
    }
    return null
}

export default {
    name: 'ceksaldo',
    aliases: ['saldo'],
    description: 'Cek saldo API GHS',
    ownerOnly: true,
    execute: async ({ sock, msg, react, useLimit }) => {
        const jid = msg.key.remoteJid
        await react('⏳')

        try {
            const payload = await ghsVerifyService.fetchCredits()
            const credits = pickCredits(payload)
            useLimit()
            await react('✅')
            await sock.sendMessage(jid, {
                text: `*SALDO API GHS*\n- Saldo API: ${credits == null ? '-' : credits}`
            }, { quoted: msg })
        } catch (err) {
            logger.warn(`[GHS] cek saldo gagal: ${err?.message || err}`)
            await react('❌')
            await sock.sendMessage(jid, {
                text: '*SALDO API GHS*\n- Saldo API: -'
            }, { quoted: msg })
        }
    }
}
