import { createManualNewsCommand } from './_manualnews.js'

export default createManualNewsCommand({
    name: 'merdeka',
    aliases: ['merdekacom'],
    description: 'Merdeka News',
    sourceUrl: 'https://www.merdeka.com/',
    linkPattern: /^https?:\/\/(?:[a-z0-9.-]+\.)?merdeka\.com\/.+-.+\.html/i,
    maxCandidates: 60,
    selector: 'a[href]'
})

