import { createRssCommand } from './_rssbase.js'

export default createRssCommand({
    name: 'jogja',
    aliases: ['jogjanews', 'jogja-news'],
    description: 'Jogja News',
    feed: 'https://jogja.news/feed/'
})
