import axios from 'axios'
import FormData from 'form-data'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

async function getSession() {
    const pageRes = await axios.get('https://www.iloveimg.com/id/hapus-latar-belakang', {
        headers: { 'User-Agent': UA },
        timeout: 60000
    })

    const token = String(pageRes.data || '').match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0]
    if (!token) throw new Error('Token not found')

    const cookies = pageRes.headers['set-cookie']?.map((c) => c.split(';')[0]).join('; ') || ''
    return { token, cookies }
}

async function rmbg(imageBuffer) {
    const session = await getSession()

    const headers = {
        Authorization: `Bearer ${session.token}`,
        'User-Agent': UA,
        Cookie: session.cookies,
        Origin: 'https://www.iloveimg.com',
        Referer: 'https://www.iloveimg.com/id/hapus-latar-belakang'
    }

    const startRes = await axios.get('https://api.iloveimg.com/v1/start/removebackgroundimage', { headers, timeout: 60000 })
    const { server, task } = startRes.data || {}
    if (!server || !task) throw new Error('Failed to start removebg task')

    const uploadForm = new FormData()
    uploadForm.append('task', task)
    uploadForm.append('file', imageBuffer, { filename: 'image.jpg', contentType: 'image/jpeg' })

    const uploadRes = await axios.post(`https://${server}/v1/upload`, uploadForm, {
        headers: { ...uploadForm.getHeaders(), ...headers },
        timeout: 120000
    })

    const rbForm = new FormData()
    rbForm.append('task', task)
    rbForm.append('server_filename', uploadRes.data?.server_filename)

    const rbRes = await axios.post(`https://${server}/v1/removebackground`, rbForm, {
        headers: { ...rbForm.getHeaders(), ...headers },
        responseType: 'arraybuffer',
        timeout: 120000
    })

    return Buffer.from(rbRes.data)
}

export { rmbg }
