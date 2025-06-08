# 多格式视频转换器

这是一个基于Node.js和React的Web应用程序，用于将不同格式的视频文件进行转换，支持多种格式之间的互相转换。

## 功能特点

- 支持多种格式转换：
  - 输入格式：MP4, MKV, MOV, AVI, FLV, WMV, IVF
  - 输出格式：IVF, MP4
- 保持原始视频画质
- 实时显示转换进度
- Mac风格用户界面
- 提供转换统计信息
- 自动清理临时文件（10分钟后）
- 适配电脑端显示

## 技术栈

### 前端
- React
- Mantine UI库
- Axios（HTTP请求）
- Socket.io（实时通信）

### 后端
- Node.js
- Express
- FFmpeg（视频处理）
- Socket.io
- Multer（文件上传）

## 运行方式

### 前提条件
- Node.js 16+ 
- FFmpeg 安装在系统上并添加到环境变量中

### 安装步骤

1. 克隆仓库
```
git clone <仓库地址>
cd ivf-web
```

2. 安装依赖
```
# 安装后端依赖
cd backend
npm install

# 安装前端依赖
cd ../frontend
npm install
```

3. 启动应用
```
# 启动后端服务器（在backend目录下）
npm run dev

# 启动前端开发服务器（在frontend目录下）
npm run dev
```

4. 在浏览器中访问应用
```
http://localhost:5173
```

## 使用说明

1. 选择输入格式和期望的输出格式
2. 点击"选择文件"按钮，上传想要转换的视频文件
3. 点击"开始转换"按钮，开始转换过程
4. 转换完成后，点击"下载转换后的文件"按钮下载转换后的视频文件
5. 注意：上传的文件和转换后的文件将在10分钟后自动删除，请及时下载

## 许可证

MIT 