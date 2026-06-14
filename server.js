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

app.get('/api/transcript', async (req, res) => {
    const videoId = req.query.videoId;
    
    if (!videoId) {
        return res.status(400).json({ error: 'videoId é obrigatório' });
    }
    
    console.log(`Buscando transcrição para: ${videoId}`);
    
    try {
        const response = await fetch(`https://pipedapi.kavin.rocks/videos/${videoId}`);
        
        if (response.ok) {
            const data = await response.json();
            
            if (data.subtitles && data.subtitles.length > 0) {
                const subtitle = data.subtitles.find(s => s.code === 'en' || s.code === 'en-US');
                if (subtitle && subtitle.url) {
                    const subResponse = await fetch(subtitle.url);
                    const subData = await subResponse.text();
                    const parsed = parseSubtitleData(subData);
                    
                    if (parsed && parsed.length > 0) {
                        console.log(`✅ Sucesso! ${parsed.length} frases`);
                        return res.json({
                            success: true,
                            videoId: videoId,
                            transcript: parsed
                        });
                    }
                }
            }
        }
        
        const fallbackResponse = await fetch(`https://youtube-transcript.vercel.app/api/transcript?videoId=${videoId}`);
        const fallbackData = await fallbackResponse.json();
        
        if (fallbackData && Array.isArray(fallbackData) && fallbackData.length > 0) {
            const formatted = fallbackData.map(segment => ({
                startTime: segment.start,
                text: segment.text
            }));
            
            return res.json({
                success: true,
                videoId: videoId,
                transcript: formatted
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
