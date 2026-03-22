import { ZAi } from '../../scrape/zai.js'

const zai = new ZAi()

export default {
    name: 'glm',
    aliases: ['zai'],
    description: 'Chat dengan AI (GLM).',
    execute: async ({ sock, msg, text, react, prefix, command, useLimit }) => {
        const jid = msg.key.remoteJid

        if (!text) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} halo, siapa kamu?`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const result = await zai.chat({
                model: 'glm-5',
                stream: false,
                max_tokens: 800,
                temperature: 0.7,
                top_p: 0.9,
                messages: [
                    {
                        role: 'system',
                        content: 'jawab pake bahasa gaul gen z banget ya. campur indo-inggris secukupnya yang relevan aja. no emoji, no tanda hubung panjang, jangan formal kayak lagi ngomong sama dosen. vibe nya harus santai dan natural kayak ngobrol sama temen tongkrongan.'
                    },
                    { role: 'user', content: text }
                ]
            })
            const reply = result?.choices?.[0]?.message?.content

            if (!reply) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: '❌ glm gak respon. coba lagi nanti.'
                }, { quoted: msg })
            }

            useLimit()
            await react('✅')
            await sock.sendMessage(jid, { text: reply }, { quoted: msg })
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${err.message}`
            }, { quoted: msg })
        }
    }
}
