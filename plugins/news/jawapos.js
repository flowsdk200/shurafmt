import { createManualNewsCommand } from './_manualnews.js'

export default createManualNewsCommand({
    name: 'jawapos',
    aliases: ['jawa', 'jawa-news'],
    description: 'Jawa Pos News',
    sourceUrl: 'https://www.jawapos.com/',
    linkPattern: /^https?:\/\/(?:[a-z0-9.-]+\.)?jawapos\.com\/.+\/\d+\/.+/i,
    maxCandidates: 60,
    selector: 'a[href]'
})

