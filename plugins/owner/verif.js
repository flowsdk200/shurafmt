import ghsVerifyService from '../../src/services/ghsVerifyService.js'

const clean = (value) => String(value || '').trim()

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
    aliases: ['verifghs', 'ghs'],
    description: 'Verifikasi GHS via email,password,otp (role student)',
    ownerOnly: true,
    execute: async ({ sock, msg, text, sender, pushName, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const parsed = parseVerifyInput(text)

        if (!parsed) {
            return sock.sendMessage(jid, {
                text:
                    'Cara penggunaan:\n' +
                    '- .verif email, password, otp\n\n' +
                    'Contoh penggunaan:\n' +
                    '- .verif emailgithubmu@gmail.com, password123, 459821'
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

        await sock.sendMessage(jid, { text: initText }, { quoted: msg })
        useLimit()
        await react('✅')

        void ghsVerifyService.submitVerificationFlow({
            email: parsed.email,
            password: parsed.password,
            otp: parsed.otp,
            role: 'student',
            chatJid: jid,
            requesterJid: sender,
            requesterName: clean(pushName)
        })
    }
}
