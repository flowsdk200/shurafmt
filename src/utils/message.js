/**
 * MESSAGE UTILITY
 * ─────────────────────────────────────────────────────────────────
 * Wrapper lengkap untuk semua tipe pesan yang didukung Baileys fork.
 * Import fungsi yang dibutuhkan di plugin manapun:
 *
 *   import { sendText, sendList, sendButtons, ... } from '../src/utils/message.js'
 *
 * Semua fungsi menerima `options` opsional sebagai parameter terakhir.
 * Contoh options: { quoted: msg }
 * ─────────────────────────────────────────────────────────────────
 */

// ─── TEXT ────────────────────────────────────────────────────────

/**
 * Kirim pesan teks biasa.
 * @param {string} [mentions] - array JID yang di-mention
 */
export const sendText = (sock, jid, text, options = {}) =>
    sock.sendMessage(jid, { text }, options)


// ─── BUTTONS (lama) ──────────────────────────────────────────────

/**
 * Kirim pesan dengan tombol teks (ButtonsMessage).
 * Catatan: tipe ini tidak selalu render di WA versi terbaru.
 *
 * @param {string}   content.text    - isi pesan
 * @param {string}   [content.footer] - teks kecil di bawah
 * @param {Array}    content.buttons  - [{ id, text }]
 *
 * @example
 * sendButtons(sock, jid, {
 *   text: 'Pilih salah satu',
 *   footer: 'Bot',
 *   buttons: [
 *     { id: 'btn1', text: 'Opsi A' },
 *     { id: 'btn2', text: 'Opsi B' },
 *   ]
 * }, { quoted: msg })
 */
export const sendButtons = (sock, jid, { text, footer, buttons }, options = {}) =>
    sock.sendMessage(jid, {
        text,
        footer,
        buttons: buttons.map((btn, i) => ({
            buttonId: btn.id ?? `btn_${i}`,
            buttonText: { displayText: btn.text },
        })),
    }, options)


// ─── LIST MESSAGE ────────────────────────────────────────────────

/**
 * Kirim list message (menu pilihan).
 *
 * @param {string}   content.title      - judul pesan
 * @param {string}   content.text       - isi/deskripsi
 * @param {string}   content.buttonText - label tombol pembuka list
 * @param {string}   [content.footer]   - teks kecil di bawah
 * @param {Array}    content.sections   - [{ title, rows: [{ id, title, description }] }]
 *
 * @example
 * sendList(sock, jid, {
 *   title: 'Menu Bot',
 *   text: 'Pilih fitur yang kamu mau',
 *   buttonText: 'Buka Menu',
 *   footer: 'Biohazard Botz',
 *   sections: [
 *     {
 *       title: 'General',
 *       rows: [
 *         { id: 'ping', title: '!ping', description: 'Status server' },
 *         { id: 'sticker', title: '!sticker', description: 'Buat sticker' },
 *       ]
 *     }
 *   ]
 * }, { quoted: msg })
 */
export const sendList = (sock, jid, { title, text, buttonText, footer, sections }, options = {}) =>
    sock.sendMessage(jid, {
        title,
        text,
        buttonText,
        footer,
        sections,
    }, options)


// ─── INTERACTIVE MESSAGE (modern, NativeFlow) ─────────────────────

/**
 * Kirim interactive message dengan tombol quick-reply (NativeFlow).
 * Ini adalah tipe tombol yang paling stabil di WA versi terbaru.
 *
 * @param {string}   content.title    - isi pesan / header
 * @param {string}   [content.footer] - teks kecil di bawah
 * @param {Array}    content.buttons  - [{ id, text }]
 *
 * @example
 * sendInteractive(sock, jid, {
 *   title: 'Kamu yakin?',
 *   footer: 'Biohazard Botz',
 *   buttons: [
 *     { id: 'yes', text: 'Ya' },
 *     { id: 'no',  text: 'Tidak' },
 *   ]
 * }, { quoted: msg })
 */
export const sendInteractive = (sock, jid, { title, footer, buttons }, options = {}) =>
    sock.sendMessage(jid, {
        text: title,
        footer,
        interactiveButtons: buttons.map((btn, i) => ({
            name: 'quick_reply',
            buttonParamsJson: JSON.stringify({
                display_text: btn.text,
                id: btn.id ?? `btn_${i}`,
            }),
        })),
    }, options)


/**
 * Kirim interactive message dengan tombol URL.
 *
 * @param {string}   content.title    - isi pesan
 * @param {string}   [content.footer] - teks kecil di bawah
 * @param {Array}    content.buttons  - [{ text, url }]
 *
 * @example
 * sendInteractiveUrl(sock, jid, {
 *   title: 'Kunjungi website',
 *   footer: 'Biohazard Botz',
 *   buttons: [
 *     { text: 'GitHub', url: 'https://github.com' },
 *   ]
 * }, { quoted: msg })
 */
export const sendInteractiveUrl = (sock, jid, { title, footer, buttons }, options = {}) =>
    sock.sendMessage(jid, {
        text: title,
        footer,
        interactiveButtons: buttons.map(btn => ({
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
                display_text: btn.text,
                url: btn.url,
                merchant_url: btn.url,
            }),
        })),
    }, options)


/**
 * Kirim interactive message dengan tombol panggilan.
 *
 * @param {string}   content.title        - isi pesan
 * @param {string}   [content.footer]     - teks kecil di bawah
 * @param {Array}    content.buttons      - [{ text, phoneNumber }]
 *
 * @example
 * sendInteractiveCall(sock, jid, {
 *   title: 'Hubungi kami',
 *   footer: 'Biohazard Botz',
 *   buttons: [
 *     { text: 'Telepon Owner', phoneNumber: '+6285226344606' },
 *   ]
 * }, { quoted: msg })
 */
export const sendInteractiveCall = (sock, jid, { title, footer, buttons }, options = {}) =>
    sock.sendMessage(jid, {
        text: title,
        footer,
        interactiveButtons: buttons.map(btn => ({
            name: 'cta_call',
            buttonParamsJson: JSON.stringify({
                display_text: btn.text,
                phone_number: btn.phoneNumber,
            }),
        })),
    }, options)


// ─── MEDIA ───────────────────────────────────────────────────────

/**
 * Kirim gambar.
 * @param {Buffer|string} image - Buffer atau URL
 * @param {string} [caption]
 */
export const sendImage = (sock, jid, image, caption = '', options = {}) =>
    sock.sendMessage(jid, {
        image: typeof image === 'string' ? { url: image } : image,
        caption,
    }, options)


/**
 * Kirim video.
 * @param {Buffer|string} video - Buffer atau URL
 * @param {string} [caption]
 * @param {boolean} [gif] - kirim sebagai GIF (gifPlayback)
 */
export const sendVideo = (sock, jid, video, caption = '', gif = false, options = {}) =>
    sock.sendMessage(jid, {
        video: typeof video === 'string' ? { url: video } : video,
        caption,
        gifPlayback: gif,
    }, options)


/**
 * Kirim audio biasa.
 * @param {Buffer|string} audio - Buffer atau URL
 */
export const sendAudio = (sock, jid, audio, options = {}) =>
    sock.sendMessage(jid, {
        audio: typeof audio === 'string' ? { url: audio } : audio,
        mimetype: 'audio/mp4',
    }, options)


/**
 * Kirim voice note (PTT / push-to-talk).
 * @param {Buffer|string} audio - Buffer atau URL (harus opus/ogg)
 */
export const sendPTT = (sock, jid, audio, options = {}) =>
    sock.sendMessage(jid, {
        audio: typeof audio === 'string' ? { url: audio } : audio,
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true,
    }, options)


/**
 * Kirim dokumen / file.
 * @param {Buffer|string} document - Buffer atau URL
 * @param {string} mimetype        - MIME type file, misal 'application/pdf'
 * @param {string} [fileName]      - nama file yang tampil
 * @param {string} [caption]
 */
export const sendDocument = (sock, jid, document, mimetype, fileName = 'file', caption = '', options = {}) =>
    sock.sendMessage(jid, {
        document: typeof document === 'string' ? { url: document } : document,
        mimetype,
        fileName,
        caption,
    }, options)


/**
 * Kirim sticker dari Buffer WebP.
 * Gunakan makeSticker() dari exif.js kalau butuh EXIF (pack/author name).
 * @param {Buffer} sticker
 */
export const sendSticker = (sock, jid, sticker, options = {}) =>
    sock.sendMessage(jid, { sticker }, options)


// ─── LOKASI & KONTAK ──────────────────────────────────────────────

/**
 * Kirim lokasi.
 * @param {number} lat  - latitude
 * @param {number} long - longitude
 * @param {string} [name] - nama lokasi
 */
export const sendLocation = (sock, jid, lat, long, name = '', options = {}) =>
    sock.sendMessage(jid, {
        location: { degreesLatitude: lat, degreesLongitude: long, name },
    }, options)


/**
 * Kirim kontak.
 * @param {string} displayName - nama tampilan
 * @param {string} vcard       - string vCard lengkap
 *
 * @example
 * sendContact(sock, jid, 'Nama Orang', `BEGIN:VCARD\nVERSION:3.0\nFN:Nama Orang\nTEL:+62812xxx\nEND:VCARD`)
 */
export const sendContact = (sock, jid, displayName, vcard, options = {}) =>
    sock.sendMessage(jid, {
        contacts: {
            displayName,
            contacts: [{ vcard }],
        },
    }, options)


// ─── POLL ─────────────────────────────────────────────────────────

/**
 * Kirim pesan polling.
 * @param {string}   name           - pertanyaan poll
 * @param {string[]} values         - pilihan jawaban (max 12)
 * @param {number}   [selectableCount] - berapa pilihan bisa dipilih (default 1)
 *
 * @example
 * sendPoll(sock, jid, 'Fitur favorit?', ['Sticker', 'AI Chat', 'RVO'], 1, { quoted: msg })
 */
export const sendPoll = (sock, jid, name, values, selectableCount = 1, options = {}) =>
    sock.sendMessage(jid, {
        poll: { name, values, selectableCount },
    }, options)


// ─── AKSI ─────────────────────────────────────────────────────────

/**
 * React ke pesan dengan emoji.
 * @param {object} key   - msg.key dari pesan yang mau di-react
 * @param {string} emoji - emoji, atau '' untuk hapus reaksi
 */
export const sendReact = (sock, jid, key, emoji) =>
    sock.sendMessage(jid, {
        react: { text: emoji, key },
    })


/**
 * Forward pesan ke JID lain.
 * @param {object} message - WAMessage lengkap
 * @param {boolean} [force] - paksa forward meskipun sudah forwarded
 */
export const sendForward = (sock, jid, message, force = false, options = {}) =>
    sock.sendMessage(jid, { forward: message, force }, options)


/**
 * Hapus pesan (untuk bot sendiri, atau pesan siapapun jika bot adalah admin).
 * @param {object} key - msg.key dari pesan yang mau dihapus
 */
export const sendDelete = (sock, jid, key) =>
    sock.sendMessage(jid, { delete: key })


/**
 * Pin pesan di grup.
 * @param {object} key  - msg.key dari pesan yang mau di-pin
 * @param {number} type - 1=pin, 2=unpin
 * @param {number} [time] - durasi: 86400 (1 hari), 604800 (7 hari), 2592000 (30 hari)
 */
export const sendPin = (sock, jid, key, type = 1, time = 86400) =>
    sock.sendMessage(jid, { pin: key, type, time })
