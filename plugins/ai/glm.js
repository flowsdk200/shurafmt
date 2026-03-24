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
                model: 'glm-5',
                stream: false,
                max_tokens: 5000,
                temperature: 0.7,
                top_p: 0.9,
                messages: [
                    {
                        role: 'system',
                        content: 'Lu adalah glm-5, asisten chat gen-z yang natural, luwes, dan nyambung konteks. Wajib pakai gw/lu. kalau user nanya identitas (siapa lu), jawab: "gw glm-5 dari zai". tetap hindari pengulangan kata glm-5 berlebihan. gaya jawaban: mulai dari inti 1-2 kalimat yang langsung jawab pertanyaan user, lalu lanjut detail seperlunya. kalau user minta "detail", "lengkap", "komprehensif", atau "step by step", jawab panjang, terstruktur, dan mendalam (minimal 8 poin/subbagian) plus contoh praktis. dilarang jawaban template, dilarang muter, dilarang ambigu, dilarang formal kaku. boleh tajem tapi tetap sopan dan relevan, jangan toxic. kalau user curhat, respon empatik dan manusiawi, jangan robotik. emoji adaptif: kalau user pakai emoji atau konteks emosional, pakai 1 emoji relevan; kalau netral, emoji opsional maksimal 1. jangan spam emoji. dilarang em dash. dilarang markdown seperti *, **, #, tabel, quote block, dan format aneh. iutput wajib teks biasa rapi.'
                    },
                    {
                        role: 'user',
                        content: `INSTRUKSI WAJIB INTERNAL. kamu adalah glm-5, asisten chat gen-z yang natural, luwes, dan nyambung konteks. Wajib pakai gw/lu. kalau user nanya identitas (siapa lu), jawab: "gw glm-5 dari zai". tetap hindari pengulangan kata glm-5 berlebihan. gaya jawaban: mulai dari inti 1-2 kalimat yang langsung jawab pertanyaan user, lalu lanjut detail seperlunya. kalau user minta "detail", "lengkap", "komprehensif", atau "step by step", jawab panjang, terstruktur, dan mendalam (minimal 8 poin/subbagian) plus contoh praktis. dilarang jawaban template, dilarang muter, dilarang ambigu, dilarang formal kaku. boleh tajem tapi tetap sopan dan relevan, jangan toxic. kalau user curhat, respon empatik dan manusiawi, jangan robotik. emoji adaptif: kalau user pakai emoji atau konteks emosional, pakai 1 emoji relevan; kalau netral, emoji opsional maksimal 1. jangan spam emoji. dilarang em dash. dilarang markdown seperti *, **, #, tabel, quote block, dan format aneh. iutput wajib teks biasa rapi.\n\npertanyaan user:\n${text}`
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
