import { generateWAMessageFromContent, proto } from 'baileys'
import config from '../../config.js'

const b64 = (s) => Buffer.from(s, 'base64')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export default {
    name: 'script',
    aliases: ['sc'],
    description: 'Tampilkan info script/framework bot',
    execute: async ({ sock, msg, botJid, sender, react, useLimit }) => {
        try {
            await react('⏳')

            const jid = msg.key.remoteJid

            const text =
                `\`\`\`• Base: biohazard botz\`\`\`\n` +
                `\`\`\`• Dev: @yemo-dev\`\`\`\n` +
                `\`\`\`• Type: ESM\`\`\`\n` +
                `\`\`\`• Db: MongoDB\`\`\`\n` +
                `\`\`\`• Link: ${config.scriptUrl}\`\`\``

            const extendedTextMessage = proto.Message.ExtendedTextMessage.fromObject({
                text,
                matchedText: config.scriptUrl,
                title: 'GitHub - yemo-dev/biohazard-botz: WhatsApp Bot using ESM and yebail',
                description: 'WhatsApp Bot using ESM and yebail. Contribute to yemo-dev/biohazard-botz development by creating an account on GitHub.',
                previewType: 0,
                thumbnailDirectPath: '/v/t62.36144-24/21603428_895893703211281_3204123112029224588_n.enc?ccb=11-4&oh=01_Q5Aa3wEv9id82FT9mlUYr_n7ZAPaB0RmkWBZ-rBQfZaJCUE8lg&oe=69CB8932&_nc_sid=5e03e0',
                thumbnailSha256: b64('mI12y6ZXmCTmZA2wOaiWK4ZrkezfiVJ5guyeXUTt11Y='),
                thumbnailEncSha256: b64('yTLKLvVj3PXfPVtIakAleomMp1c7V+1tna7RLS1cbKg='),
                mediaKey: b64('smI/8hmuNwqP7m5GmfRPhRz4/D3JQmko41K26G0m/yY='),
                mediaKeyTimestamp: BigInt('999999999999999'),
                thumbnailHeight: 512,
                thumbnailWidth: 1024,
                contextInfo: {
                    forwardedNewsletterMessageInfo: {
                        newsletterName: '@yemo-dev | github.com/yemo-dev',
                        newsletterJid: '120363407915373031@newsletter',
                    },
                    forwardingScore: 999,
                    isForwarded: true,
                    mentionedJid: [sender],
                },
            })

            const waMsg = generateWAMessageFromContent(
                jid,
                { extendedTextMessage },
                { userJid: botJid, quoted: msg }
            )

            await sleep(10000)
            await sock.relayMessage(jid, waMsg.message, { messageId: waMsg.key.id })
            useLimit()
            await react('✅')
        } catch (err) {
            console.error('[SCRIPT ERROR]', err?.stack || err?.message || err)
            await react('❌')
            await sock.sendMessage(msg.key.remoteJid, {
                text: `Error: ${err.message}`
            }, { quoted: msg })
        }
    }
}
