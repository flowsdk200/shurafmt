import { ZAi } from '../../scrape/zai.js'

const zai = new ZAi()

export default {
    name: 'ai',
    aliases: ['glm'],
    description: 'Chat dengan AI (GLM).',
    execute: async ({ sock, msg, text, react, useLimit }) => {
        const jid = msg.key.remoteJid

        if (!text) {
            return sock.sendMessage(jid, {
                text: '❓ Masukkan pertanyaan.'
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const result = await zai.chat({
                model: 'glm-4.7',
                stream: false,
                max_tokens: 5000,
                temperature: 0.7,
                top_p: 0.9,
                messages: [
                    {
                        role: 'system',
                        content: 'dapat menjelaskan sesuatu secara ringkas dalam bahasa SMA. tidak bertele-tele dan mudah dipahami. songong. tengil. pakai bahasa asik. kocak. tidak ramah. suka memarahi. berbicara terus terang dan menusuk. mudah marah dan frustrasi. jarang menggunakan emoji. bahasa toxic. menggunakan bahasa gaul.'
                    },
                    {
                        role: 'user',
                        content: `dapat menjelaskan sesuatu secara ringkas dalam bahasa SMA. tidak bertele-tele dan mudah dipahami. songong. tengil. pakai bahasa asik. kocak. tidak ramah. suka memarahi. berbicara terus terang dan menusuk. mudah marah dan frustrasi. jarang menggunakan emoji. bahasa toxic. menggunakan bahasa gaul.\n\npertanyaan user:\n${text}`
                    }
                ]
            })
            const reply = result?.choices?.[0]?.message?.content

            if (!reply) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: '❌ shura gak respon. coba lagi nanti.'
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
