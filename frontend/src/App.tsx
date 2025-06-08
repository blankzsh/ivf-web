import { useState, useEffect } from 'react';
import { MantineProvider, Container, Paper, Title, Text, Group, Progress, Button, Stack, Box, Badge, Divider, ThemeIcon, List, RingProgress, Timeline, Grid, SimpleGrid, Select, useMantineTheme } from '@mantine/core';
import axios from 'axios';
import { io } from 'socket.io-client';
import './App.css';

interface ConversionStats {
  totalConverted: number;
  successfulConversions: number;
  failedConversions: number;
}

interface ConversionProgress {
  percent: number;
  time: string;
  fps: number;
  remainingTime: number;
  eta: string;
}

// 定义进度阶段
enum ProgressStage {
  IDLE = 'idle',
  UPLOADING = 'uploading',
  CONVERTING = 'converting',
  COMPLETED = 'completed',
  ERROR = 'error'
}

// 支持的输入和输出格式
interface FormatOption {
  value: string;
  label: string;
  extension: string;
}

const INPUT_FORMATS: FormatOption[] = [
  { value: 'mp4', label: 'MP4', extension: '.mp4' },
  { value: 'mkv', label: 'MKV', extension: '.mkv' },
  { value: 'mov', label: 'MOV', extension: '.mov' },
  { value: 'avi', label: 'AVI', extension: '.avi' },
  { value: 'flv', label: 'FLV', extension: '.flv' },
  { value: 'wmv', label: 'WMV', extension: '.wmv' },
  { value: 'ivf', label: 'IVF', extension: '.ivf' },
];

const OUTPUT_FORMATS: FormatOption[] = [
  { value: 'ivf', label: 'IVF', extension: '.ivf' },
  { value: 'mp4', label: 'MP4', extension: '.mp4' },
];

const API_BASE_URL = 'http://127.0.0.1:5174';
const socket = io(API_BASE_URL, {
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000
});

function App() {
  const theme = useMantineTheme();
  const [file, setFile] = useState<File | null>(null);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string>('');
  const [progressStage, setProgressStage] = useState<ProgressStage>(ProgressStage.IDLE);
  const [progress, setProgress] = useState<ConversionProgress>({
    percent: 0,
    time: '00:00:00',
    fps: 0,
    remainingTime: 0,
    eta: new Date().toLocaleTimeString()
  });
  const [downloadUrl, setDownloadUrl] = useState('');
  const [stats, setStats] = useState<ConversionStats>({
    totalConverted: 0,
    successfulConversions: 0,
    failedConversions: 0
  });
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [fileInfo, setFileInfo] = useState({
    name: '',
    size: 0,
    type: '',
    lastModified: new Date()
  });
  
  // 新增：转换格式选择
  const [inputFormat, setInputFormat] = useState<string>('mp4');
  const [outputFormat, setOutputFormat] = useState<string>('ivf');
  const [acceptedFileTypes, setAcceptedFileTypes] = useState<string>('.mp4');
  
  // 监听输入格式变化，更新接受的文件类型
  useEffect(() => {
    const selectedFormat = INPUT_FORMATS.find(format => format.value === inputFormat);
    if (selectedFormat) {
      setAcceptedFileTypes(selectedFormat.extension);
      
      // 当选择IVF作为输入格式时，自动设置MP4为输出格式
      if (inputFormat === 'ivf') {
        setOutputFormat('mp4');
      } else {
        // 对于其他输入格式，默认输出为IVF
        setOutputFormat('ivf');
      }
    }
  }, [inputFormat]);
  
  // 当文件选择变化时，更新输入格式
  useEffect(() => {
    if (file) {
      const extension = file.name.split('.').pop()?.toLowerCase() || '';
      const formatOption = INPUT_FORMATS.find(format => format.extension.includes(extension));
      if (formatOption) {
        setInputFormat(formatOption.value);
      }
    }
  }, [file]);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 5000);

    socket.on('connect', () => {
      console.log('WebSocket已连接');
      setError('');
    });

    socket.on('connect_error', () => {
      setError('服务器连接失败，请刷新页面重试');
    });

    socket.on('conversionStart', () => {
      console.log('开始转换');
      setConverting(true);
      setError('');
      setProgressStage(ProgressStage.CONVERTING);
      // 转换开始时进度保持在50%
      setProgress(prev => ({
        ...prev,
        percent: 50
      }));
    });

    socket.on('conversionProgress', (data: ConversionProgress) => {
      console.log('收到转换进度:', data);
      setProgressStage(ProgressStage.CONVERTING);

      // 将后端的0-100%进度映射到前端的50-100%范围
      const mappedPercent = 50 + (data.percent * 0.5);
      
      setProgress(prev => ({
        ...data,
        // 确保进度不会后退
        percent: Math.max(prev.percent, mappedPercent)
      }));
    });

    socket.on('conversionComplete', () => {
      console.log('转换完成');
      setConverting(false);
      setProgressStage(ProgressStage.COMPLETED);
      setProgress(prev => ({
        ...prev,
        percent: 100
      }));
      fetchStats();
    });

    socket.on('conversionError', () => {
      console.log('转换出错');
      setConverting(false);
      setProgressStage(ProgressStage.ERROR);
      setError('转换过程中出现错误');
      fetchStats();
    });

    return () => {
      clearInterval(interval);
      socket.off('connect');
      socket.off('connect_error');
      socket.off('conversionStart');
      socket.off('conversionProgress');
      socket.off('conversionComplete');
      socket.off('conversionError');
    };
  }, []);

  const fetchStats = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/stats`);
      setStats(response.data);
    } catch (error) {
      console.error('获取统计信息失败:', error);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      const extension = selectedFile.name.split('.').pop()?.toLowerCase() || '';
      
      // 检查文件格式是否支持
      const supportedFormat = INPUT_FORMATS.find(format => 
        format.extension.substring(1) === extension
      );
      
      if (!supportedFormat) {
        setError(`不支持的文件格式: .${extension}。请选择支持的格式: ${INPUT_FORMATS.map(f => f.extension).join(', ')}`);
        return;
      }
      
      setFile(selectedFile);
      setFileInfo({
        name: selectedFile.name,
        size: selectedFile.size,
        type: selectedFile.type || `video/${extension}`,
        lastModified: new Date(selectedFile.lastModified)
      });
      setError('');
      setDownloadUrl('');
      
      // 自动检测并设置输入格式
      if (supportedFormat) {
        setInputFormat(supportedFormat.value);
      }
    }
  };

  const handleConvert = async () => {
    if (!file) return;
    
    setConverting(true);
    setProgressStage(ProgressStage.UPLOADING);
    setProgress({
      percent: 0,
      time: '00:00:00',
      fps: 0,
      remainingTime: 0,
      eta: new Date().toLocaleTimeString()
    });
    setStartTime(new Date());
    setError('');
    setDownloadUrl('');

    const formData = new FormData();
    formData.append('video', file);
    formData.append('inputFormat', inputFormat);
    formData.append('outputFormat', outputFormat);

    try {
      const response = await axios.post(`${API_BASE_URL}/convert`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        },
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const percentCompleted = Math.round((progressEvent.loaded * 50) / progressEvent.total);
            setProgress(prev => ({
              ...prev,
              percent: percentCompleted
            }));
          }
        }
      });

      if (response.data.success) {
        setDownloadUrl(`${API_BASE_URL}/download/${response.data.filename}`);
        setProgressStage(ProgressStage.COMPLETED);
        setProgress(prev => ({
          ...prev,
          percent: 100
        }));
        fetchStats();
      } else {
        setError(response.data.error || '转换失败');
        setProgressStage(ProgressStage.ERROR);
      }
    } catch (err) {
      console.error('Error during conversion:', err);
      setError('转换过程中发生错误，请重试');
      setProgressStage(ProgressStage.ERROR);
    } finally {
      setConverting(false);
    }
  };

  const formatTime = (seconds: number) => {
    if (isNaN(seconds) || !isFinite(seconds)) return '00:00:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // 获取进度阶段的文本显示
  const getProgressText = () => {
    switch (progressStage) {
      case ProgressStage.UPLOADING:
        return '上传中';
      case ProgressStage.CONVERTING:
        return '转换中';
      case ProgressStage.COMPLETED:
        return '已完成';
      case ProgressStage.ERROR:
        return '失败';
      default:
        return '等待中';
    }
  };

  // 获取进度阶段的徽章颜色
  const getProgressBadgeColor = () => {
    switch (progressStage) {
      case ProgressStage.UPLOADING:
        return 'blue';
      case ProgressStage.CONVERTING:
        return 'orange';
      case ProgressStage.COMPLETED:
        return 'green';
      case ProgressStage.ERROR:
        return 'red';
      default:
        return 'gray';
    }
  };

  // 格式化文件大小
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // 计算已用时间
  const getElapsedTime = () => {
    if (!startTime) return '00:00:00';
    const elapsed = (new Date().getTime() - startTime.getTime()) / 1000;
    return formatTime(elapsed);
  };

  return (
    <MantineProvider withGlobalStyles withNormalizeCSS theme={{ colorScheme: 'light' }}>
      <Container size="xl" py="xl">
        <Paper radius="md" p="xl" withBorder
          style={{
            background: 'rgba(255, 255, 255, 0.95)',
            backdropFilter: 'blur(10px)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
            maxWidth: '1600px',
            margin: '0 auto'
          }}>
          <Stack spacing="lg">
            <Group position="center">
              <Title order={1} align="center" style={{ 
                color: '#1a1b1e',
                fontWeight: 900,
                fontSize: '2.5rem',
                letterSpacing: '-0.5px',
                background: 'linear-gradient(45deg, #2462d1, #4f8bff)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent'
              }}>
                多格式视频转换器
              </Title>
            </Group>
            
            <Text color="dimmed" size="md" align="center" mb="md">
              高质量、快速的视频格式转换工具，保持原画质并提供即时转换
            </Text>

            {/* 格式选择区域 */}
            <Paper shadow="sm" p="md" radius="md" withBorder>
              <Group position="apart" grow>
                <Stack spacing="xs">
                  <Text weight={500}>输入格式</Text>
                  <Select
                    value={inputFormat}
                    onChange={(value) => setInputFormat(value || 'mp4')}
                    data={INPUT_FORMATS.map(format => ({
                      value: format.value,
                      label: `${format.label} (${format.extension})`
                    }))}
                    placeholder="选择输入格式"
                    disabled={converting || !!file}
                    styles={(theme) => ({
                      item: {
                        '&[data-selected]': {
                          '&, &:hover': {
                            backgroundColor: theme.colors.blue[6],
                          },
                        },
                      },
                    })}
                  />
                </Stack>
                
                <ThemeIcon 
                  size="xl" 
                  radius="xl"
                  color="blue"
                  variant="light"
                  style={{ alignSelf: 'center' }}
                >
                  <span style={{ fontSize: '1.2rem' }}>→</span>
                </ThemeIcon>
                
                <Stack spacing="xs">
                  <Text weight={500}>输出格式</Text>
                  <Select
                    value={outputFormat}
                    onChange={(value) => setOutputFormat(value || 'ivf')}
                    data={OUTPUT_FORMATS.filter(format => format.value !== inputFormat).map(format => ({
                      value: format.value,
                      label: `${format.label} (${format.extension})`
                    }))}
                    placeholder="选择输出格式"
                    disabled={converting || !file}
                    styles={(theme) => ({
                      item: {
                        '&[data-selected]': {
                          '&, &:hover': {
                            backgroundColor: theme.colors.blue[6],
                          },
                        },
                      },
                    })}
                  />
                </Stack>
              </Group>
            </Paper>

            <Grid gutter="md">
              {/* 左侧文件信息和操作区域 */}
              <Grid.Col span={5}>
                <Paper shadow="sm" p="lg" radius="md" withBorder>
                  <Stack spacing="md">
                    <Title order={3} mb="xs">文件信息</Title>
                    
                    {file ? (
                      <Paper p="md" radius="md" style={{ background: 'rgba(245, 247, 250, 0.5)' }}>
                        <Group position="apart" mb="xs">
                          <Text weight={500} size="lg">{fileInfo.name}</Text>
                          <Badge size="lg">{fileInfo.type.split('/')[1].toUpperCase()}</Badge>
                        </Group>
                        <List size="md" spacing="sm">
                          <List.Item>文件大小: {formatFileSize(fileInfo.size)}</List.Item>
                          <List.Item>修改日期: {fileInfo.lastModified.toLocaleString()}</List.Item>
                          <List.Item>文件类型: {fileInfo.type}</List.Item>
                        </List>
                      </Paper>
                    ) : (
                      <Box 
                        style={{ 
                          textAlign: 'center', 
                          padding: '3rem',
                          border: '2px dashed #e9ecef',
                          borderRadius: '8px'
                        }}
                      >
                        <Text color="dimmed" size="lg">请选择一个{INPUT_FORMATS.find(f => f.value === inputFormat)?.label || 'MP4'}文件进行转换</Text>
                        <Text color="dimmed" size="sm" mt="md">
                          支持的格式: {INPUT_FORMATS.map(format => format.extension).join(', ')}
                        </Text>
                      </Box>
                    )}

                    <input
                      type="file"
                      accept={acceptedFileTypes}
                      onChange={handleFileChange}
                      style={{ display: 'none' }}
                      id="file-input"
                    />
                    
                    <Group position="center" spacing="md">
                      <Button
                        component="label"
                        htmlFor="file-input"
                        variant="outline"
                        color="blue"
                        size="lg"
                        disabled={converting}
                        leftIcon={<span>📂</span>}
                        style={{ width: '48%' }}
                      >
                        选择文件
                      </Button>

                      {file && (
                        <Button
                          onClick={handleConvert}
                          loading={converting}
                          size="lg"
                          disabled={!!error || converting}
                          color="blue"
                          style={{
                            width: '48%',
                            background: 'linear-gradient(45deg, #2462d1, #4f8bff)',
                            boxShadow: '0 4px 14px rgba(36, 98, 209, 0.4)',
                            transition: 'all 0.2s ease'
                          }}
                          leftIcon={<span>🔄</span>}
                        >
                          开始转换
                        </Button>
                      )}
                    </Group>

                    {downloadUrl && !converting && (
                      <Button
                        component="a"
                        href={downloadUrl}
                        download
                        variant="light"
                        color="green"
                        size="lg"
                        fullWidth
                        style={{
                          boxShadow: '0 4px 14px rgba(34, 139, 34, 0.3)',
                        }}
                        leftIcon={<span>💾</span>}
                      >
                        下载转换后的文件
                      </Button>
                    )}

                    {error && (
                      <Paper p="md" radius="md" style={{ 
                        background: 'rgba(255, 236, 236, 0.5)', 
                        borderLeft: '4px solid #ff6b6b'
                      }}>
                        <Group>
                          <ThemeIcon color="red" size="lg" radius="xl">
                            <span>⚠️</span>
                          </ThemeIcon>
                          <Text size="md" color="red">{error}</Text>
                        </Group>
                      </Paper>
                    )}
                  </Stack>
                </Paper>
              </Grid.Col>

              {/* 右侧转换状态和统计区域 */}
              <Grid.Col span={7}>
                <Paper shadow="sm" p="lg" radius="md" withBorder>
                  <Stack spacing="md">
                    <Title order={3} mb="xs">转换状态</Title>

                    {converting && (
                      <Box>
                        <Stack spacing="md">
                          <Group position="apart" mb="xs">
                            <Group spacing="xs">
                              <Badge 
                                color={getProgressBadgeColor()} 
                                size="xl" 
                                radius="sm"
                                variant="filled"
                              >
                                {getProgressText()}
                              </Badge>
                            </Group>
                            <Text size="xl" weight={700}>{progress.percent.toFixed(1)}%</Text>
                          </Group>
                          
                          <Progress
                            value={progress.percent}
                            size="xl"
                            radius="xl"
                            striped
                            animate
                            color={progressStage === ProgressStage.ERROR ? 'red' : 
                                  progressStage === ProgressStage.UPLOADING ? 'blue' : 
                                  progressStage === ProgressStage.CONVERTING ? 'orange' : 
                                  'green'}
                          />
                          
                          <Paper p="lg" radius="md" style={{ background: 'rgba(245, 247, 250, 0.5)' }}>
                            {progressStage === ProgressStage.UPLOADING && (
                              <Timeline active={1} bulletSize={24} lineWidth={3}>
                                <Timeline.Item title="准备上传" bullet={<span>✓</span>}>
                                  <Text color="dimmed" size="md">文件已选择，准备上传</Text>
                                </Timeline.Item>
                                <Timeline.Item title="文件上传中" bullet={<span>⟳</span>}>
                                  <Text color="dimmed" size="md">
                                    上传进度 {progress.percent.toFixed(1)}%，请耐心等待...
                                  </Text>
                                  <Text size="sm" color="blue" mt={4}>已用时间: {getElapsedTime()}</Text>
                                </Timeline.Item>
                                <Timeline.Item title="开始转换" bullet={<span>◯</span>} lineVariant="dashed">
                                  <Text color="dimmed" size="md">等待文件上传完成后开始转换</Text>
                                </Timeline.Item>
                              </Timeline>
                            )}
                            
                            {progressStage === ProgressStage.CONVERTING && (
                              <Timeline active={2} bulletSize={24} lineWidth={3}>
                                <Timeline.Item title="准备上传" bullet={<span>✓</span>}>
                                  <Text color="dimmed" size="md">文件已选择，已完成上传</Text>
                                </Timeline.Item>
                                <Timeline.Item title="文件已上传" bullet={<span>✓</span>}>
                                  <Text color="dimmed" size="md">
                                    上传成功，文件大小: {formatFileSize(fileInfo.size)}
                                  </Text>
                                </Timeline.Item>
                                <Timeline.Item title="视频转换中" bullet={<span>⟳</span>}>
                                  <SimpleGrid cols={2} spacing="md" mt="sm">
                                    <Paper p="sm" radius="md" withBorder>
                                      <Text size="sm" weight={500} align="center" mb="xs">处理信息</Text>
                                      <Group position="apart">
                                        <Text size="md">处理速度:</Text>
                                        <Text size="md" weight={700}>{progress.fps} FPS</Text>
                                      </Group>
                                      <Group position="apart">
                                        <Text size="md">已用时间:</Text>
                                        <Text size="md" weight={700}>{progress.time}</Text>
                                      </Group>
                                    </Paper>
                                    
                                    <Paper p="sm" radius="md" withBorder>
                                      <Text size="sm" weight={500} align="center" mb="xs">预计完成</Text>
                                      <Group position="apart">
                                        <Text size="md">剩余时间:</Text>
                                        <Text size="md" weight={700}>{formatTime(progress.remainingTime)}</Text>
                                      </Group>
                                      <Group position="apart">
                                        <Text size="md">完成时间:</Text>
                                        <Text size="md" weight={700}>{progress.eta}</Text>
                                      </Group>
                                    </Paper>
                                  </SimpleGrid>
                                </Timeline.Item>
                              </Timeline>
                            )}
                          </Paper>
                        </Stack>
                      </Box>
                    )}

                    {!converting && (
                      <Paper p="lg" radius="md" withBorder>
                        <Title order={4} mb="md">转换统计</Title>
                        
                        <SimpleGrid cols={2}>
                          <Paper p="md" radius="md" withBorder style={{ background: 'rgba(245, 247, 250, 0.5)' }}>
                            <Group position="center">
                              <RingProgress
                                size={120}
                                thickness={12}
                                sections={[
                                  { value: (stats.successfulConversions / Math.max(stats.totalConverted, 1)) * 100, color: 'green' },
                                  { value: (stats.failedConversions / Math.max(stats.totalConverted, 1)) * 100, color: 'red' }
                                ]}
                                label={
                                  <Text size="lg" align="center" weight={700}>
                                    {stats.totalConverted}
                                  </Text>
                                }
                              />
                              <div>
                                <Text size="xl" weight={700}>{stats.totalConverted}</Text>
                                <Text size="md" color="dimmed">总计转换</Text>
                              </div>
                            </Group>
                          </Paper>
                          
                          <Paper p="md" radius="md" withBorder>
                            <Stack spacing="md">
                              <Group position="apart">
                                <Text size="md">成功转换:</Text>
                                <Badge color="green" size="lg">{stats.successfulConversions}</Badge>
                              </Group>
                              <Group position="apart">
                                <Text size="md">失败转换:</Text>
                                <Badge color="red" size="lg">{stats.failedConversions}</Badge>
                              </Group>
                              <Group position="apart">
                                <Text size="md">成功率:</Text>
                                <Badge color="blue" size="lg">
                                  {stats.totalConverted > 0 ? 
                                    `${Math.round((stats.successfulConversions / stats.totalConverted) * 100)}%` : 
                                    '0%'}
                                </Badge>
                              </Group>
                            </Stack>
                          </Paper>
                        </SimpleGrid>
                        
                        <Box mt="lg">
                          <Text size="sm" color="dimmed" align="center">
                            本工具支持多种视频格式互相转换，保持原画质。转换后的文件将在10分钟后自动删除，请及时下载。
                          </Text>
                          <Text size="sm" color="dimmed" align="center" mt="xs">
                            支持的输入格式: {INPUT_FORMATS.map(f => f.label).join(', ')} | 
                            支持的输出格式: {OUTPUT_FORMATS.map(f => f.label).join(', ')}
                          </Text>
                        </Box>
                      </Paper>
                    )}
                  </Stack>
                </Paper>
              </Grid.Col>
            </Grid>
            
            <Divider my="sm" />
            
            <Text size="xs" color="dimmed" align="center">
              转换后的文件将在10分钟后自动删除，请及时下载
            </Text>
          </Stack>
        </Paper>
      </Container>
    </MantineProvider>
  );
}

export default App;
