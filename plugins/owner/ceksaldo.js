import ghsWebVerifyService from '../../src/services/ghsWebVerifyService.js'
const toMentionTag = (jid = '') => `@${String(jid || '').split('@')[0]}`

export default {
    name: 'ceksaldo',
    aliases: ['saldo'],
    description: 'Cek saldo coins verifikasi GHS',
    ownerOnly: false,
    execute: async ({ sock, msg, react, useLimit, sender, usersDb }) => {
        const jid = msg.key.remoteJid
        await react('⏳')

        try {
            const coins = usersDb.getCoins(sender)
            const verifyCost = ghsWebVerifyService.getVerificationCost()
            useLimit()
            await react('✅')
            await sock.sendMessage(jid, {
                text: [
                    '*SALDO COINS*',
                    `- Users: ${toMentionTag(sender)}`,
                    `- Coins: ${coins}`,
                    `- Verification costs student → ${verifyCost} coins`
                ].join('\n'),
                mentions: [sender]
            }, { quoted: msg })
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: '*SALDO COINS*\n- Coins: -'
            }, { quoted: msg })
        }
    }
}
