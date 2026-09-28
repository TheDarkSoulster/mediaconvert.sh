import React, { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  ThemeProvider,
  createTheme,
  CssBaseline,
  Container,
  Typography,
  Box,
  Paper,
  Button,
  Select,
  MenuItem,
  ListSubheader,
  LinearProgress,
  IconButton,
  Stack,
  Chip,
  Alert,
} from '@mui/material';
import {
  Download as DownloadIcon,
  InsertDriveFile as FileIcon,
  Close as CloseIcon,
  UploadFile as UploadIcon,
  Image as ImageIcon,
} from '@mui/icons-material';
import '@fontsource/roboto/300.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';

const theme = createTheme({
  palette: {
    mode: 'dark',
    background: {
      default: '#121212',
      paper: '#1e1e1e',
    },
    primary: { main: '#a8c7fa' },
  },
  shape: { borderRadius: 16 },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none', boxShadow: 'none' },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 24 },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 10 },
      },
    },
  },
});

interface Job {
  id: string;
  originalName: string;
  metadata: ProbeMetadata;
  mediaKind: MediaKind;
  targetFormat: OutputFormat;
  progress: number;
  status: 'idle' | 'processing' | 'complete' | 'error';
  error?: string;
}

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  sample_rate?: string;
}

interface ProbeMetadata {
  streams?: ProbeStream[];
  format?: {
    duration?: string;
    format_name?: string;
  };
}

type MediaKind = 'image' | 'video' | 'audio' | 'other';
type OutputFormat =
  | 'mp4'
  | 'mkv'
  | 'webm'
  | 'mov'
  | 'mp3'
  | 'wav'
  | 'flac'
  | 'png'
  | 'jpg'
  | 'jpeg'
  | 'webp'
  | 'avif'
  | 'gif'
  | 'bmp'
  | 'tiff';

interface FormatOption {
  value: OutputFormat;
  label: string;
  group: 'Video' | 'Audio' | 'Images';
  hint?: string;
}

const videoFormats: FormatOption[] = [
  { value: 'mp4', label: 'MP4', group: 'Video' },
  { value: 'mkv', label: 'MKV', group: 'Video' },
  { value: 'webm', label: 'WebM', group: 'Video' },
  { value: 'mov', label: 'MOV', group: 'Video' },
];

const audioFormats: FormatOption[] = [
  { value: 'mp3', label: 'MP3', group: 'Audio' },
  { value: 'wav', label: 'WAV · Lossless', group: 'Audio' },
  { value: 'flac', label: 'FLAC · Lossless', group: 'Audio' },
];

const imageFormats: FormatOption[] = [
  { value: 'png', label: 'PNG', group: 'Images', hint: 'Lossless' },
  { value: 'jpg', label: 'JPEG', group: 'Images' },
  { value: 'webp', label: 'WebP', group: 'Images' },
  { value: 'avif', label: 'AVIF', group: 'Images' },
  { value: 'gif', label: 'GIF', group: 'Images' },
  { value: 'bmp', label: 'BMP', group: 'Images' },
  { value: 'tiff', label: 'TIFF', group: 'Images' },
];

function getOutputFormats(kind: MediaKind): FormatOption[] {
  if (kind === 'image') return [...imageFormats, ...videoFormats];
  if (kind === 'video') return [...videoFormats, ...audioFormats, ...imageFormats];
  if (kind === 'audio') return [...audioFormats];
  return [...videoFormats, ...audioFormats, ...imageFormats];
}

function getDefaultFormat(kind: MediaKind): OutputFormat {
  if (kind === 'image') return 'png';
  if (kind === 'audio') return 'mp3';
  return 'mp4';
}

function getMediaLabel(kind: MediaKind): string {
  switch (kind) {
    case 'image':
      return 'Image';
    case 'video':
      return 'Video';
    case 'audio':
      return 'Audio';
    default:
      return 'Media';
  }
}

export default function App() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    setError(null);

    for (const file of acceptedFiles) {
      try {
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Upload failed');
        }

        const mediaKind = (data.mediaKind || 'other') as MediaKind;
        const options = getOutputFormats(mediaKind);

        setJobs((prev) => [
          ...prev,
          {
            id: data.jobId,
            originalName: data.originalName,
            metadata: data.metadata,
            mediaKind,
            targetFormat: options.length ? getDefaultFormat(mediaKind) : 'mp4',
            progress: 0,
            status: 'idle',
          },
        ]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed');
      }
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    noClick: true,
    multiple: true,
  });

  const removeJob = (jobId: string) => {
    setJobs((prev) => prev.filter((job) => job.id !== jobId));
  };

  const startConversion = (jobId: string, format: OutputFormat) => {
    setError(null);
    setJobs((prev) =>
      prev.map((job) =>
        job.id === jobId
          ? { ...job, targetFormat: format, status: 'processing', progress: 0, error: undefined }
          : job,
      ),
    );

    const sse = new EventSource(
      `/api/convert/${encodeURIComponent(jobId)}?format=${encodeURIComponent(format)}`,
    );

    sse.onmessage = (event) => {
      const data = JSON.parse(event.data) as {
        percent?: number;
        status: Job['status'];
        message?: string;
      };

      setJobs((prev) =>
        prev.map((job) => {
          if (job.id !== jobId) return job;
          if (data.status === 'processing') {
            return { ...job, progress: Math.max(0, Math.min(100, data.percent || 0)) };
          }
          if (data.status === 'complete') {
            return { ...job, progress: 100, status: 'complete' };
          }
          if (data.status === 'error') {
            return { ...job, status: 'error', error: data.message || 'Conversion failed' };
          }
          return job;
        }),
      );

      if (data.status === 'complete' || data.status === 'error') {
        sse.close();
      }
    };

    sse.onerror = () => {
      setJobs((prev) =>
        prev.map((job) =>
          job.id === jobId && job.status === 'processing'
            ? { ...job, status: 'error', error: 'Connection to the local converter was lost.' }
            : job,
        ),
      );
      sse.close();
    };
  };

  const handleDownload = (jobId: string, format: OutputFormat) => {
    window.location.assign(
      `/api/download/${encodeURIComponent(jobId)}?format=${encodeURIComponent(format)}`,
    );
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Container maxWidth="sm" sx={{ py: { xs: 4, sm: 7 } }}>
        <Box textAlign="center" mb={5}>
          <Typography variant="h4" fontWeight={700} gutterBottom>
            MediaConvert.sh
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Convert almost anything. Locally. Privately. Offline.
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2, borderRadius: 3 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <Paper
          {...getRootProps()}
          component="section"
          sx={{
            p: { xs: 4, sm: 6 },
            textAlign: 'center',
            cursor: 'pointer',
            border: '2px dashed',
            borderColor: isDragActive ? 'primary.main' : 'divider',
            bgcolor: isDragActive ? 'action.hover' : 'background.paper',
            transition: 'all 0.2s ease',
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          <input {...getInputProps()} />
          <UploadIcon sx={{ fontSize: 42, mb: 1, color: 'text.secondary' }} />
          <Typography variant="h6" color="text.primary">
            {isDragActive ? 'Drop files here' : 'Drag & drop files here'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2.5 }}>
            or choose files from your computer
          </Typography>
          <Button variant="outlined" onClick={open}>
            Browse files
          </Button>
        </Paper>

        <Stack spacing={2} sx={{ mt: 4 }}>
          {jobs.map((job) => {
            const videoStream = job.metadata?.streams?.find((stream) => stream.codec_type === 'video');
            const audioStream = job.metadata?.streams?.find((stream) => stream.codec_type === 'audio');
            const sizeInfo = [
              videoStream?.width && videoStream.height ? `${videoStream.width}×${videoStream.height}` : null,
              videoStream?.codec_name || audioStream?.codec_name || null,
            ]
              .filter(Boolean)
              .join(' · ');
            const formats = getOutputFormats(job.mediaKind);
            const groupedFormats = ['Video', 'Audio', 'Images']
              .map((group) => ({ group, formats: formats.filter((format) => format.group === group) }))
              .filter((section) => section.formats.length > 0);

            return (
              <Paper key={job.id} sx={{ p: 2.25 }}>
                <Box display="flex" justifyContent="space-between" alignItems="center" gap={2}>
                  <Box display="flex" alignItems="center" gap={1.5} minWidth={0}>
                    {job.mediaKind === 'image' ? <ImageIcon color="action" /> : <FileIcon color="action" />}
                    <Box minWidth={0}>
                      <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                        {job.originalName}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {getMediaLabel(job.mediaKind)}{sizeInfo ? ` · ${sizeInfo}` : ''}
                      </Typography>
                    </Box>
                  </Box>
                  <IconButton size="small" onClick={() => removeJob(job.id)} aria-label="Remove file">
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Box>

                {job.status === 'idle' && (
                  <Box display="flex" justifyContent="space-between" alignItems="center" gap={2} mt={2} flexWrap="wrap">
                    <Box display="flex" alignItems="center" gap={1} minWidth={0}>
                      <Typography variant="body2" color="text.secondary">
                        Convert to:
                      </Typography>
                      <Select
                        size="small"
                        value={job.targetFormat}
                        onChange={(event) => {
                          const value = event.target.value as OutputFormat;
                          setJobs((prev) =>
                            prev.map((item) => (item.id === job.id ? { ...item, targetFormat: value } : item)),
                          );
                        }}
                        sx={{ borderRadius: 2, minWidth: 170 }}
                      >
                        {groupedFormats.map((section) => [
                          <ListSubheader key={`${section.group}-header`}>{section.group}</ListSubheader>,
                          ...section.formats.map((format) => (
                            <MenuItem key={format.value} value={format.value}>
                              {format.label}
                              {format.hint ? ` · ${format.hint}` : ''}
                              {job.mediaKind === 'video' && format.group === 'Images' ? ' · First frame' : ''}
                            </MenuItem>
                          )),
                        ])}
                      </Select>
                    </Box>
                    <Button
                      variant="contained"
                      disableElevation
                      onClick={() => startConversion(job.id, job.targetFormat)}
                    >
                      Convert
                    </Button>
                  </Box>
                )}

                {job.status === 'processing' && (
                  <Box mt={2}>
                    <Box display="flex" justifyContent="space-between" mb={1}>
                      <Typography variant="caption" color="text.secondary">
                        Processing intelligently…
                      </Typography>
                      <Typography variant="caption">{Math.round(job.progress)}%</Typography>
                    </Box>
                    <LinearProgress variant="determinate" value={job.progress} sx={{ borderRadius: 1, height: 6 }} />
                  </Box>
                )}

                {job.status === 'complete' && (
                  <Box display="flex" justifyContent="space-between" alignItems="center" gap={2} mt={2}>
                    <Chip label="Complete" color="success" size="small" variant="outlined" />
                    <Button
                      variant="contained"
                      disableElevation
                      startIcon={<DownloadIcon />}
                      onClick={() => handleDownload(job.id, job.targetFormat)}
                    >
                      Save file
                    </Button>
                  </Box>
                )}

                {job.status === 'error' && (
                  <Box mt={2} display="flex" justifyContent="space-between" alignItems="center" gap={2}>
                    <Typography variant="caption" color="error.main" sx={{ overflowWrap: 'anywhere' }}>
                      {job.error || 'Conversion failed.'}
                    </Typography>
                    <Button variant="outlined" onClick={() => startConversion(job.id, job.targetFormat)}>
                      Retry
                    </Button>
                  </Box>
                )}
              </Paper>
            );
          })}
        </Stack>

        {jobs.length === 0 && (
          <Box textAlign="center" mt={5}>
            <Typography variant="body2" color="text.secondary">
              Your files never leave this computer.
            </Typography>
          </Box>
        )}
      </Container>
    </ThemeProvider>
  );
}
