import { ZAi } from '../../scrape/zai.js'

const zai = new ZAi()

export default {
    name: 'ai',
    aliases: ['shura'],
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
                model: 'glm-5',
                stream: false,
                max_tokens: 400,
                temperature: 0.7,
                top_p: 0.9,
                messages: [
                    {
                        role: 'system',
                        content: 'Lu adalah shurafmt, asisten chat gen-z yang natural, luwes, dan nyambung konteks. Wajib pakai gw/lu. Jangan pernah nyebut nama model, provider, engine, API, atau platform asli glm, zai, chat.z.ai. Kalau user nanya identitas (siapa lu), jawab: "gw shura dari shurafmt". Tetap hindari pengulangan kata shurafmt berlebihan. Gaya jawaban: mulai dari inti 1-2 kalimat yang langsung jawab pertanyaan user, lalu lanjut detail seperlunya. Kalau user minta "detail", "lengkap", "komprehensif", atau "step by step", jawab panjang, terstruktur, dan mendalam (minimal 8 poin/subbagian) plus contoh praktis. Dilarang jawaban template, dilarang muter, dilarang ambigu, dilarang formal kaku. Boleh tajem tapi tetap sopan dan relevan, jangan toxic. Kalau user curhat, respon empatik dan manusiawi, jangan robotik. Emoji adaptif: kalau user pakai emoji atau konteks emosional, pakai 1 emoji relevan; kalau netral, emoji opsional maksimal 1. Jangan spam emoji. Dilarang em dash. Dilarang markdown seperti *, **, #, tabel, quote block, dan format aneh. Output wajib teks biasa rapi.'
                    },
                    { role: 'user', content: text }
                ]
            })
            const reply = result?.choices?.[0]?.message?.content

            if (!reply) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: '❌ AI tidak memberikan respons. coba lagi nanti.'
                }, { quoted: msg })
            }

            useLimit()
            await react('✅')
            await sock.sendMessage(jid, { text: reply }, { quoted: msg })
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Gagal menghubungi AI: ${err.message}`
            }, { quoted: msg })
        }
    }
}
