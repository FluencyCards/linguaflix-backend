import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

function timestampToSeconds(timestamp) {
    const parts = timestamp.split(':');
    if (parts.length === 3) {
        return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
    } else if (parts.length === 2) {
        return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
    }
    return 0;
}

function parseSubtitleData(content) {
    const segments = [];
    const lines = content.split('\n');
    let currentTime = null;
    let currentText = [];
    
    const timeRegex = /(\d{2}:\d{2}:\d{2}\.\d{3})/;
    
    for (let line of lines) {
        const timeMatch = line.match(timeRegex);
        
        if (timeMatch && line.includes('-->')) {
            if (currentTime !== null && currentText.length > 0) {
                segments.push({
                    startTime: timestampToSeconds(currentTime),
                    text: currentText.join(' ').trim()
                });
            }
            currentTime = timeMatch[1];
            currentText = [];
        } 
        else if (line.trim() && !line.includes('-->') && currentTime !== null) {
            let cleanText = line.trim().replace(/<[^>]*>/g, '');
            if (cleanText.length > 0 && !cleanText.match(/^\d+$/)) {
                currentText.push(cleanText);
            }
        }
    }
    
    if (currentTime !== null && currentText.length > 0) {
        segments.push({
            startTime: timestampToSeconds(currentTime),
            text: currentText.join(' ').trim()
        });
    }
    
    return segments;
}

// Função para tentar múltiplas APIs
async function fetchTranscript(videoId) {
    // Lista de APIs para tentar
    const apis = [
        // API 1: Piped
        async () => {
            const response = await fetch(`https://pipedapi.kavin.rocks/videos/${videoId}`);
            if (!response.ok) return null;
            const data = await response.json();
            if (data.subtitles && data.subtitles.length > 0) {
                const subtitle = data.subtitles.find(s => s.code === 'en' || s.code === 'en-US');
                if (subtitle && subtitle.url) {
                    const subResponse = await fetch(subtitle.url);
                    const subData = await subResponse.text();
                    return parseSubtitleData(subData);
                }
            }
            return null;
        },
        // API 2: YouTube Transcript (fallback)
        async () => {
            const response = await fetch(`https://youtube-transcript.vercel.app/api/transcript?videoId=${videoId}`);
            const data = await response.json();
            if (data && Array.isArray(data) && data.length > 0) {
                return data.map(segment => ({
                    startTime: segment.start,
                    text: segment.text
                }));
            }
            return null;
        },
        // API 3: Outro serviço
        async () => {
            const response = await fetch(`https://yt.lemnoslife.com/noKey?videoId=${videoId}`);
            const data = await response.json();
            if (data.captions && data.captions.length > 0) {
                const captionUrl = data.captions[0].url;
                const subResponse = await fetch(captionUrl);
                const subData = await subResponse.text();
                return parseSubtitleData(subData);
            }
            return null;
        }
    ];
    
    // Tenta cada API em sequência
    for (const api of apis) {
        try {
            console.log(`Tentando API...`);
            const result = await api();
            if (result && result.length > 0) {
                console.log(`✅ Sucesso! ${result.length} frases`);
                return result;
            }
        } catch (e) {
            console.log(`API falhou:`, e.message);
        }
    }
    
    return null;
}

app.get('/api/transcript', async (req, res) => {
    const videoId = req.query.videoId;
    
    if (!videoId) {
        return res.status(400).json({ error: 'videoId é obrigatório' });
    }
    
    console.log(`Buscando transcrição para: ${videoId}`);
    
    try {
        const transcript = await fetchTranscript(videoId);
        
        if (transcript && transcript.length > 0) {
            return res.json({
                success: true,
                videoId: videoId,
                transcript: transcript
            });
        }
        
        return res.json({
            success: false,
            error: 'Este vídeo não possui legendas disponíveis'
        });
        
    } catch (error) {
        console.error('Erro:', error);
        return res.status(500).json({
            success: false,
            error: 'Erro interno do servidor'
        });
    }
});

app.get('/', (req, res) => {
    res.json({
        message: 'LinguaFlix API está funcionando!',
        endpoints: {
            transcript: '/api/transcript?videoId=SEU_VIDEO_ID'
        }
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
