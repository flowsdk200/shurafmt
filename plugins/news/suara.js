import { createManualNewsCommand } from './_manualnews.js'

export default createManualNewsCommand({
    name: 'suara',
    aliases: ['suarac'],
    description: 'Suara.com News',
    sourceUrl: 'https://www.suara.com/news',
    linkPattern: /^https?:\/\/(?:www\.)?suara\.com\/news\/\d{4}\/\d{2}\/\d{2}\/\d+\/[a-z0-9-]+/i,
    maxCandidates: 80,
    selector: 'a[href]'
})
