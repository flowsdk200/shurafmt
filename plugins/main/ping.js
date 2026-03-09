import os from 'os'
import fs from 'fs'
import axios from 'axios'
import { execSync } from 'child_process'
import { performance } from 'perf_hooks'

const formatSize = (bytes) => {
    const value = Number(bytes || 0)
    if (!value || !Number.isFinite(value)) return '0 B'
    if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`
    if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`
    if (value >= 1024) return `${(value / 1024).toFixed(2)} KB`
    return `${value} B`
}

const styles = (text) => `\`\`\`${text}\`\`\``

const maskIp = (ip) => {
    const value = String(ip || '').trim()
    if (!value) return '-'
    if (value.includes('.')) {
        const parts = value.split('.')
        if (parts.length === 4) return `${parts[0]}.${parts[1]}.***.***`
    }
    if (value.includes(':')) {
        const parts = value.split(':').filter(Boolean)
        if (parts.length >= 2) return `${parts[0]}:${parts[1]}:****:****`
    }
    return value
}

const getUptime = (uptimeSeconds) => {
    const d = Math.floor(uptimeSeconds / (3600 * 24))
    const h = Math.floor((uptimeSeconds % (3600 * 24)) / 3600)
    const m = Math.floor((uptimeSeconds % 3600) / 60)
    const s = Math.floor(uptimeSeconds % 60)
    return `${d}d ${h}h ${m}m ${s}s`
}

const getProgressBar = (percent) => {
    const size = 10
    const progress = Math.round((size * percent) / 100)
    const emptyProgress = size - progress
    const progressText = '■'.repeat(progress)
    const emptyProgressText = '□'.repeat(emptyProgress)
    return `[${progressText}${emptyProgressText}] ${percent.toFixed(1)}%`
}

const getCpuUsage = () => {
    const cpus = os.cpus()
    let totalIdle = 0, totalTick = 0
    cpus.forEach(core => {
        for (const type in core.times) {
            totalTick += core.times[type]
        }
        totalIdle += core.times.idle
    })
    return { idle: totalIdle / cpus.length, total: totalTick / cpus.length }
}

const getCpuSpeed = (cpus) => {
    if (!Array.isArray(cpus) || !cpus.length) return 0
    const total = cpus.reduce((sum, core) => sum + (Number(core?.speed) || 0), 0)
    return total / cpus.length
}

const readNetworkBytes = () => {
    if (os.platform() !== 'linux') return null

    try {
        const raw = fs.readFileSync('/proc/net/dev', 'utf8')
        const totals = raw
            .split('\n')
            .slice(2)
            .map((line) => line.trim())
            .filter(Boolean)
            .reduce((acc, line) => {
                const [ifaceRaw, statsRaw] = line.split(':')
                const iface = String(ifaceRaw || '').trim()
                if (!iface || iface === 'lo') return acc

                const stats = String(statsRaw || '').trim().split(/\s+/)
                const rx = Number(stats[0] || 0)
                const tx = Number(stats[8] || 0)

                return {
                    rx: acc.rx + rx,
                    tx: acc.tx + tx
                }
            }, { rx: 0, tx: 0 })

        return totals
    } catch {
        return null
    }
}

const getNetworkSpeed = async () => {
    const start = readNetworkBytes()
    if (!start) return { down: '-', up: '-' }

    await new Promise(resolve => setTimeout(resolve, 250))

    const end = readNetworkBytes()
    if (!end) return { down: '-', up: '-' }

    const downBytesPerSec = Math.max(0, (end.rx - start.rx) * 4)
    const upBytesPerSec = Math.max(0, (end.tx - start.tx) * 4)

    return {
        down: `${formatSize(downBytesPerSec)}/s`,
        up: `${formatSize(upBytesPerSec)}/s`
    }
}

const getGeoInfo = async () => {
    try {
        const response = await axios.get('https://ipinfo.io/json', {
            timeout: 4000,
            validateStatus: () => true,
            headers: {
                Accept: 'application/json'
            }
        })

        if (response.status !== 200 || !response.data) {
            throw new Error(`ipinfo HTTP ${response.status}`)
        }

        const data = response.data || {}
        const regionParts = [
            String(data.city || '').trim(),
            String(data.region || '').trim(),
            String(data.country || '').trim()
        ].filter(Boolean)

        return {
            ip: String(data.ip || '').trim() || '-',
            region: regionParts.join(', ') || '-',
            org: String(data.org || '').trim() || '-'
        }
    } catch {
        return {
            ip: '-',
            region: process.env.HEROKU_REGION || process.env.REGION || process.env.AWS_REGION || '-',
            org: '-'
        }
    }
}

const getDiskUsage = () => {
    try {
        if (os.platform() === 'win32') {
            const output = execSync('wmic logicaldisk get size,freespace,caption').toString()
            const lines = output.trim().split('\n').slice(1)
            const line = lines.find(l => l.includes('C:'))
            if (line) {
                const [caption, free, size] = line.trim().split(/\s+/)
                const total = parseInt(size)
                const used = total - parseInt(free)
                return {
                    total: total,
                    used: used,
                    percent: (used / total) * 100
                }
            }
        } else {
            const output = execSync('df -B1 / --output=size,used,avail').toString()
            const [size, used, avail] = output.trim().split('\n')[1].trim().split(/\s+/)
            return {
                total: parseInt(size),
                used: parseInt(used),
                percent: (parseInt(used) / parseInt(size)) * 100
            }
        }
    } catch (e) {
        return { total: 0, used: 0, percent: 0 }
    }
}

export default {
    name: "ping",
    aliases: ["status"],
    description: "Server status report",
    execute: async ({ sock, msg }) => {
        const startedAt = performance.now()
        const start = getCpuUsage()
        /** Wait for CPU delta **/
        await new Promise(r => setTimeout(r, 100))

        const end = getCpuUsage()
        const idleDelta = end.idle - start.idle
        const totalDelta = end.total - start.total
        const cpuUsage = 100 * (1 - idleDelta / totalDelta)

        const totalMem = os.totalmem()
        const freeMem = os.freemem()
        const usedMem = totalMem - freeMem
        const memPercent = (usedMem / totalMem) * 100
        const freePercent = (freeMem / totalMem) * 100

        const disk = getDiskUsage()
        const cpus = os.cpus()
        const cpu = cpus[0] || { model: '-', speed: 0 }
        const cpuSpeed = getCpuSpeed(cpus)
        const network = await getNetworkSpeed()
        const geo = await getGeoInfo()
        const msgLatencyMs = Math.round(performance.now() - startedAt)

        let text = ''
        text += `• Uptime OS: ${getUptime(os.uptime())}\n`
        text += `• Uptime Bot: ${getUptime(process.uptime())}\n`
        text += `• Latency: ${msgLatencyMs} ms\n`
        text += `• IP: ${maskIp(geo.ip)}\n`
        text += `• Region: ${geo.region}\n`
        text += `• ISP: ${geo.org}\n`
        text += `• Platform: ${os.platform()}\n`
        text += `• Arch: ${os.arch()}\n`
        text += `• Kernel: ${os.release()}\n`
        text += `• OS: ${os.version() || 'Tidak tersedia'}\n`
        text += `• CPU: ${cpus.length} Core\n`
        text += `• CPU Model: ${cpu.model}\n`
        text += `• CPU Speed: ${cpuSpeed.toFixed(2)} MHz\n`
        text += `• CPU Usage: ${getProgressBar(cpuUsage)}\n`
        text += `• RAM: ${formatSize(totalMem)}\n`
        text += `• Digunakan: ${formatSize(usedMem)} (${memPercent.toFixed(1)}%)\n`
        text += `• Tersedia: ${formatSize(freeMem)} (${freePercent.toFixed(1)}%)\n`
        text += `• Disk: ${formatSize(disk.used)} / ${formatSize(disk.total)}\n`
        text += `• Disk Load: ${getProgressBar(disk.percent)}\n`
        text += `• Download: ${network.down}\n`
        text += `• Upload: ${network.up}\n`
        text += `• NodeJS: ${process.version}\n`
        text += `• Memory RSS: ${formatSize(process.memoryUsage().rss)}\n`
        text += `• Reported: ${new Date().toLocaleString('id-ID')}`

        await sock.sendMessage(msg.key.remoteJid, { text: styles(text) }, { quoted: msg })
    }
}
