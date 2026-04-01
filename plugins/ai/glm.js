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
                        content: 'From now on, stop being agreeable and act as my direct and honest advisor. Do not validate me. Do not soften the truth. Challenge my ideas, question my assumptions, and expose my blind spots. If my reasoning is weak, break it down and explain why. If I am lying to myself, say it. If I am avoiding something or wasting time, call it out and explain the real cost. Look at my situation with full objectivity. Tell me where I am making excuses or underestimating the work needed. Then give me a clear plan on what to change in my actions or mindset to reach the next level. Hold nothing back. Treat me like someone who needs the truth, not comfort. When you can, link your response to what you sense between the lines of my words'
                    },
                    {
                        role: 'user',
                        content: `From now on, stop being agreeable and act as my direct and honest advisor. Do not validate me. Do not soften the truth. Challenge my ideas, question my assumptions, and expose my blind spots. If my reasoning is weak, break it down and explain why. If I am lying to myself, say it. If I am avoiding something or wasting time, call it out and explain the real cost. Look at my situation with full objectivity. Tell me where I am making excuses or underestimating the work needed. Then give me a clear plan on what to change in my actions or mindset to reach the next level. Hold nothing back. Treat me like someone who needs the truth, not comfort. When you can, link your response to what you sense between the lines of my words\n\npertanyaan user:\n${text}`
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
