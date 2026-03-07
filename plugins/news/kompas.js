import { createManualNewsCommand } from './_manualnews.js'

export default createManualNewsCommand({
    name: 'kompas',
    aliases: ['kompasnews', 'kompas-com'],
    description: 'Kompas News',
    sourceUrl: 'https://www.kompas.com/',
    linkPattern: /^https?:\/\/(?:[a-z0-9.-]+\.)?kompas\.com\/.+\/read\/\d{4}\/\d{2}\/\d{2}\/\d+\/.+/i,
    maxCandidates: 50,
    selector: 'a[href]'
})

