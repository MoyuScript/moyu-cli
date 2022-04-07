/**
 * 哔哩哔哩视频下载
 */

const {Command} = require('commander')
const settings = require('./settings')
const {create} = require('axios').default
const bvid = require('bvid')
const sanitize = require("sanitize-filename");
const chalk = require('chalk')
const Gauge= require('gauge')
const stream = require('stream')
const path = require('path')
const fs = require('fs')
const cp = require('child_process')
const prettyBytes = require('pretty-bytes')

/**
 * 
 * @param {(sizeRead: number) => void} callback 
 */
function createProgressStream(callback) {
  const s1 = new class extends stream.Transform {
    _transform(chunk, encoding, cb) {
      callback(chunk.length)
      cb(null, chunk)
    }
  }

  return s1
}

const axios = create({
  headers: {
    'cookie': settings.get('bili-vd.cookie') || '',
    'user-agent': 'Mozilla/5.0',
    'referer': 'https://www.bilibili.com/'
  }
})

function normalizeId(id) {
  if (id.startsWith('BV')) {
    return id;
  } else if (id.toLowerCase().startsWith('av')) {
    return bvid.encode(id.slice(2))
  } else {
    throw new Error('视频 ID 错误')
  }
}

function throwIfCodeNotEqualZero(responseData) {
  if (responseData.code !== 0) {
    throw new Error('API 响应错误：' + responseData.message)
  }
}

async function fetchMeta(id) {
  const url = 'https://api.bilibili.com/x/web-interface/view'
  id = normalizeId(id)

  const params = {
    bvid: id
  }

  const res = await axios.get(url, {
    params,
    responseType: 'json'
  })

  const data = res.data

  throwIfCodeNotEqualZero(data)

  return data.data
}

async function fetchDownloadUrl(id, cid) {
  const url = 'https://api.bilibili.com/x/player/playurl'
  id = normalizeId(id)
  
  const res = await axios.get(url, {
    params: {
      cid,
      qn: 120,
      type: '',
      otype: 'json',
      fourk: 1,
      bvid: id,
      fnver: 0,
      fnval: 976
    },
    responseType: 'json'
  })

  const data = res.data
  
  throwIfCodeNotEqualZero(data)

  return data.data
}

/**
 * 
 * @param {string} url 
 * @param {string} path 
 * @param {(number) => void} onProgress 
 */
async function downloadFile(url, path, onProgress) {
  const threads = 5

  // 探测 content-length
  const res = await axios.head(url)

  const totalSize = Number(res.headers['content-length'])
  console.log('文件大小：', prettyBytes(totalSize))

  let sizeDownloaded = 0
  const sizePerThread = Math.floor(totalSize / threads)

  const promises = []

  const rangesFilepath = []

  for (let thread = 0; thread < threads; thread++) {
    let range = ''
    if (thread + 1 == threads) {
      // Last chunk
      range = `${thread * sizePerThread}-`
    } else {
      range = `${thread * sizePerThread}-${(thread * sizePerThread) + sizePerThread - 1}`
    }

    const rangeFilename = path + '_' + range;
    rangesFilepath.push(rangeFilename)

    const res = await axios.get(url, {
      responseType: 'stream',
      headers: {
        'range': 'bytes=' + range
      }
    });

    promises.push(new Promise((resolve) => {
      const progressStream = createProgressStream((sizeRead) => {
        sizeDownloaded += sizeRead
        onProgress(sizeDownloaded / totalSize)
      })
  
      res.data.pipe(progressStream)
      const f = fs.createWriteStream(rangeFilename)
      progressStream.pipe(f)

      f.on('finish', () => resolve())
    }))
  }

  await Promise.all(promises)

  // 合并文件
  
  const f = fs.createWriteStream(path)

  const append = (p) => {
    return new Promise(resolve => {
      const rangeFile = fs.createReadStream(p)
    
      rangeFile.on('data', (chunk) => {
        f.write(chunk)
      })

      rangeFile.on('close', () => {
        fs.rmSync(p)
        resolve()
      })
    })
  }

  for (const p of rangesFilepath) {
    await append(p)
  }

  f.close()

  return new Promise((resolve) => {
    f.on('finish', () => resolve())
  })
}

/**
 * 
 * @param {string} id 
 * @param {number[]} pages 
 * @param {string} output
 */
async function downloadVideo(id, pages, meta, output, height = 2160) {
  for (const page of pages) {
    const filename = `${meta.bvid} p${page.page} ${sanitize(page.part)}-${sanitize(meta.title)}`
    const outputPath = path.resolve(output, filename + '.mp4')
    console.log(chalk.blueBright(`下载 ${filename}`))
    
    const downloadUrl = await fetchDownloadUrl(meta.bvid, page.cid)
    
    const video = downloadUrl.dash.video.find((v) => v.height <= height);
    if (!video) {
      throw new Error(`没有高度低于 ${height} 的视频。`)
    }
    videoUrl = video.baseUrl

    const audio = downloadUrl.dash.audio[0]
    audioUrl = audio.baseUrl

    console.log(`视频分辨率：${video.width}*${video.height}`)
    const videoTempFilename = filename + '_video_temp.m4s'
    const audioTempFilename = filename + '_audio_temp.m4s'

    const gauge = new Gauge()
    
    await downloadFile(videoUrl, path.resolve(output, videoTempFilename), (perc) => {
      gauge.show(`下载视频中 ${(perc * 100).toFixed(2)}%`, perc)
    })

    gauge.hide()
    console.log('下载视频完成')

    await downloadFile(audioUrl, path.resolve(output, audioTempFilename), (perc) => {
      gauge.show(`下载音频中 ${(perc * 100).toFixed(2)}%`, perc)
    })

    gauge.hide()
    console.log('下载音频完成')

    console.log('混流中')

    const ffmpegPath = settings.get('bili-vd.ffmpeg') || 'ffmpeg'
    cp.spawnSync(
      ffmpegPath, 
      [
        '-i', 
        path.resolve(output, videoTempFilename), 
        '-i', 
        path.resolve(output, audioTempFilename),
        '-c:v',
        'copy',
        '-c:a',
        'copy',
        '-y',
        outputPath
      ],
      {
        stdio: ['ignore', 'ignore', 'ignore']
      }
    )

    // cleanup
    fs.rmSync(path.resolve(output, videoTempFilename))
    fs.rmSync(path.resolve(output, audioTempFilename))

    console.log('已保存至：', outputPath, '\n')
  }
}

const cmd = new Command('bili-vd')

cmd.description('哔哩哔哩视频下载')
  .option('-i --id <id>', '要下载的视频 BV/AV 号')
  .option('-p --page <page>', '指定要下载的分 P 索引号，设置为"all"将下载所有分 P', 1)
  .option('-b --batch <path>', '从文本文件指定的视频号批量下载，一行一个，将会下载所有分 P')
  .option('-o --output <outputPath>', '输出文件夹路径')
  .option('--height <height>', '最大视频高度（2160, 1080, 720, 480 等）', (value) => parseInt(value, 10), 2160)
  .action(async ({id, page, batch, output = process.cwd(), height}) => {
    output = path.normalize(output)
    if (batch) {
      // 批量下载视频
      const list = fs.readFileSync(batch, {encoding: 'utf-8'})
        .split('\n')
        .map(v => v.trim())
        .filter(v => v.length !== 0)

      for (const id of list) {
        const meta = await fetchMeta(id)
        const pages = meta.pages;

        await downloadVideo(id, pages, meta, output, height)
      }
    } else {
      // 下载单个视频
      if (!id) {
        console.log('需要参数 -i --id')
        return;
      }

      const meta = await fetchMeta(id)
      const pages = meta.pages;

      if (page !== 'all') {
        page = parseInt(page)
      }

      if (page < 1) {
        console.log('参数 -p --page 必须大于或等于 1')
        return;
      }

      if (page > pages.length) {
        console.log(`参数 -p --page 大于视频实际分 P 数，实际共有 ${pages.length} P`)
        return;
      }

      const pagesCidToDownload = []

      if (page === 'all') {
        pagesCidToDownload.push(...pages)
      } else {
        pagesCidToDownload.push(pages[page - 1])
      }
      
      await downloadVideo(meta.bvid, pagesCidToDownload, meta, output, height)
    }
  })

cmd.addHelpText('after', `
配置：
  bili-vd.cookie - Cookie 设置，用于下载时登录
  bili-vd.ffmpeg - FFmpeg 路径
`)

exports.command = cmd