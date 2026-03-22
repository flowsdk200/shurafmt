import { createManualNewsCommand } from './_manualnews.js'

export default createManualNewsCommand({
    name: 'idntimes',
    aliases: ['idn', 'idnt'],
    description: 'IDN Times News',
    sourceUrl: 'https://www.idntimes.com/news',
    linkPattern: /^https?:\/\/(?:www\.)?idntimes\.com\/news\/[a-z0-9-]+\/[a-z0-9-]+-[0-9a-z]{2}-[0-9a-z]{4}-[0-9a-z]+/i,
    maxCandidates: 80,
    selector: 'a[href]'
})
