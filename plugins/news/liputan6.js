import { createManualNewsCommand } from './_manualnews.js'

export default createManualNewsCommand({
    name: 'liputan6',
    aliases: ['liputan'],
    description: 'Liputan6 News',
    sourceUrl: 'https://www.liputan6.com/',
    linkPattern: /^https?:\/\/(?:[a-z0-9.-]+\.)?liputan6\.com\/.+\/read\/\d+\/.+/i,
    maxCandidates: 60,
    selector: 'a[href]'
})

