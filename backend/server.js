const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// 设置跨域访问
app.use(cors());
app.use(express.json());

// 创建上传和输出目录
const uploadDir = path.join(__dirname, 'uploads');
const outputDir = path.join(__dirname, 'output');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// 配置文件存储
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // 生成唯一文件名
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const fileExtension = path.extname(file.originalname);
    cb(null, uniqueSuffix + fileExtension);
  }
});

// 文件过滤器
const fileFilter = (req, file, cb) => {
  // 支持的输入格式
  const supportedFormats = ['.mp4', '.mkv', '.mov', '.avi', '.flv', '.wmv', '.ivf'];
  const fileExt = path.extname(file.originalname).toLowerCase();
  
  if (supportedFormats.includes(fileExt)) {
    cb(null, true);
  } else {
    cb(new Error(`不支持的文件格式: ${fileExt}。支持的格式: ${supportedFormats.join(', ')}`));
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 1024 * 1024 * 500 } // 500MB
});

// 维护转换统计
let conversionStats = {
  totalConverted: 0,
  successfulConversions: 0,
  failedConversions: 0
};

// 获取统计数据
app.get('/stats', (req, res) => {
  res.json(conversionStats);
});

// 文件上传和转换
app.post('/convert', upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: '没有上传文件' });
  }

  const inputPath = req.file.path;
  const inputFormat = req.body.inputFormat || 'mp4';
  const outputFormat = req.body.outputFormat || 'ivf';
  const fileName = path.basename(inputPath, path.extname(inputPath));
  const outputPath = path.join(outputDir, `${fileName}.${outputFormat}`);
  
  console.log(`开始转换: ${inputPath} -> ${outputPath}`);
  console.log(`输入格式: ${inputFormat}, 输出格式: ${outputFormat}`);

  // 根据输入输出格式设置转换参数
  let ffmpegCommand = ffmpeg(inputPath);
  
  // 根据输出格式设置编码器和参数
  if (outputFormat === 'ivf') {
    ffmpegCommand
      .videoCodec('libvpx') // VP8 编码器用于IVF
      .addOptions([
        '-b:v 1M',          // 视频比特率
        '-quality good',    // 质量设置
        '-cpu-used 0',      // CPU使用率，0为最佳质量
        '-deadline best'    // 编码质量
      ]);
  } else if (outputFormat === 'mp4') {
    ffmpegCommand
      .videoCodec('libx264') // H.264编码器用于MP4
      .addOptions([
        '-preset slow',     // 较慢的预设以获得更好的质量
        '-crf 22',          // 恒定速率因子，较低的值 = 更高的质量
        '-pix_fmt yuv420p'  // 像素格式，广泛兼容
      ]);
  }
  
  // 保持原音频
  ffmpegCommand.audioCodec('aac');
  
  // 保持原视频尺寸
  ffmpegCommand.size('?x?');

  // 设置输出路径
  ffmpegCommand.output(outputPath);

  // 监听转换进度
  ffmpegCommand.on('progress', (progress) => {
    // 发送进度信息到前端
    io.emit('progress', {
      percent: progress.percent,
      time: progress.timemark,
      fps: progress.currentFps || 0,
      remaining: progress.percent < 100 ? (100 - progress.percent) * (progress.frames / progress.currentFps) / 100 : 0,
      eta: new Date(Date.now() + ((100 - progress.percent) * (progress.frames / progress.currentFps) * 1000) / 100).toLocaleTimeString()
    });
  });

  // 开始转换
  ffmpegCommand.on('end', () => {
    console.log('转换完成:', outputPath);
    conversionStats.totalConverted++;
    conversionStats.successfulConversions++;
    
    // 设置10分钟后自动删除文件
    setTimeout(() => {
      try {
        if (fs.existsSync(inputPath)) {
          fs.unlinkSync(inputPath);
          console.log('已删除原始文件:', inputPath);
        }
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
          console.log('已删除转换后的文件:', outputPath);
        }
      } catch (err) {
        console.error('删除文件失败:', err);
      }
    }, 10 * 60 * 1000); // 10分钟
    
    return res.json({ 
      success: true, 
      filename: path.basename(outputPath)
    });
  })
  .on('error', (err) => {
    console.error('转换失败:', err);
    conversionStats.totalConverted++;
    conversionStats.failedConversions++;
    io.emit('error', '视频转换失败: ' + err.message);
    return res.status(500).json({ 
      success: false, 
      error: '视频转换失败: ' + err.message 
    });
  })
  .run();
});

// 文件下载
app.get('/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(outputDir, filename);
  
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).json({ success: false, error: '文件不存在或已被删除' });
  }
});

// 启动服务器
const PORT = process.env.PORT || 5174;
server.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
});

// 定期清理临时文件
const cleanupFiles = () => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30分钟
  
  // 清理上传目录
  fs.readdir(uploadDir, (err, files) => {
    if (err) {
      console.error('读取上传目录失败:', err);
      return;
    }
    
    files.forEach(file => {
      const filePath = path.join(uploadDir, file);
      fs.stat(filePath, (err, stats) => {
        if (err) {
          console.error(`获取文件信息失败: ${file}`, err);
          return;
        }
        
        if (now - stats.mtime.getTime() > maxAge) {
          fs.unlink(filePath, err => {
            if (err) {
              console.error(`删除文件失败: ${file}`, err);
              return;
            }
            console.log(`已清理过期文件: ${file}`);
          });
        }
      });
    });
  });
  
  // 清理输出目录
  fs.readdir(outputDir, (err, files) => {
    if (err) {
      console.error('读取输出目录失败:', err);
      return;
    }
    
    files.forEach(file => {
      const filePath = path.join(outputDir, file);
      fs.stat(filePath, (err, stats) => {
        if (err) {
          console.error(`获取文件信息失败: ${file}`, err);
          return;
        }
        
        if (now - stats.mtime.getTime() > maxAge) {
          fs.unlink(filePath, err => {
            if (err) {
              console.error(`删除文件失败: ${file}`, err);
              return;
            }
            console.log(`已清理过期文件: ${file}`);
          });
        }
      });
    });
  });
};

// 每小时运行一次清理
setInterval(cleanupFiles, 60 * 60 * 1000);

// 程序退出时清理
process.on('SIGINT', () => {
  console.log('应用程序正在关闭，清理文件...');
  cleanupFiles();
  process.exit(0);
}); 