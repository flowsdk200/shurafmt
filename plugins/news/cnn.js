import { createNewsCommand } from './_base.js'

export default createNewsCommand({
    name: 'cnn',
    aliases: ['cnnnews', 'berita-cnn'],
    description: 'CNN News',
    path: 'cnn-news',
    categories: ['nasional', 'internasional', 'ekonomi', 'olahraga', 'teknologi', 'hiburan', 'gaya-hidup'],
})
