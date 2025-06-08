const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const { Server } = require('socket.io');
const http = require('http');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());

// 创建上传和输出目录
const uploadsDir = path.join(__dirname, 'uploads');
const outputDir = path.join(__dirname, 'output');

if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
}

// 存储转换统计信息
let conversionStats = {
    totalConverted: 0,
    successfulConversions: 0,
    failedConversions: 0
};

// 文件清理函数
const cleanupFiles = (filePath) => {
    setTimeout(() => {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`Deleted file: ${filePath}`);
        }
    }, 10 * 60 * 1000); // 10分钟后删除
};

// WebSocket连接处理
io.on('connection', (socket) => {
    console.log('客户端已连接');

    socket.on('disconnect', () => {
        console.log('客户端已断开连接');
    });
});

// 上传并转换视频
app.post('/convert', upload.single('video'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: '没有上传文件' });
    }

    const inputPath = req.file.path;
    const outputFileName = `${Date.now()}.ivf`;
    const outputPath = path.join(outputDir, outputFileName);

    let duration = 0;
    let startTime = Date.now();

    // 获取视频时长
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
        if (!err && metadata.format && metadata.format.duration) {
            duration = metadata.format.duration;
        }
    });

    ffmpeg(inputPath)
        .outputOptions([
            '-c:v libvpx',
            '-crf 10',
            '-b:v 2M',
            '-c:a libvorbis'
        ])
        .toFormat('ivf')
        .on('start', () => {
            io.emit('conversionStart', { status: 'started' });
            console.log('开始转换');
        })
        .on('progress', (progress) => {
            try {
                const percent = Math.round(progress.percent * 100) / 100;
                const time = progress.timemark;
                const fps = Math.round(progress.currentFps) || 0;
                
                // 计算剩余时间（秒）
                const elapsedTime = (Date.now() - startTime) / 1000;
                const estimatedTotalTime = (elapsedTime / (percent / 100));
                const remainingTime = Math.max(0, estimatedTotalTime - elapsedTime);
                
                // 计算预计完成时间
                const etaTime = new Date(Date.now() + (remainingTime * 1000));
                
                const progressData = {
                    percent: percent || 0,
                    time: time || '00:00:00',
                    fps: fps,
                    remainingTime: Math.round(remainingTime),
                    eta: etaTime.toLocaleTimeString()
                };
                
                io.emit('conversionProgress', progressData);
                console.log(`转换进度: ${percent}% | 时间: ${time} | FPS: ${fps}`);
            } catch (error) {
                console.error('处理进度时出错:', error);
            }
        })
        .on('end', () => {
            conversionStats.totalConverted++;
            conversionStats.successfulConversions++;
            
            io.emit('conversionComplete', { status: 'completed' });
            
            // 设置文件清理定时器
            cleanupFiles(inputPath);
            cleanupFiles(outputPath);

            res.json({
                success: true,
                outputFile: outputFileName
            });
        })
        .on('error', (err) => {
            console.error('转换错误:', err);
            conversionStats.totalConverted++;
            conversionStats.failedConversions++;
            
            io.emit('conversionError', { error: '转换失败' });
            res.status(500).json({ error: '转换失败' });
        })
        .save(outputPath);
});

// 获取转换后的视频
app.get('/download/:filename', (req, res) => {
    const filePath = path.join(outputDir, req.params.filename);
    if (fs.existsSync(filePath)) {
        res.download(filePath);
    } else {
        res.status(404).json({ error: '文件不存在' });
    }
});

// 获取转换统计信息
app.get('/stats', (req, res) => {
    res.json(conversionStats);
});

const PORT = process.env.PORT || 5174;
server.listen(PORT, '127.0.0.1', () => {
    console.log(`服务器运行在 http://127.0.0.1:${PORT}`);
}); 