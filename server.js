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

// ======================== 6 MÉTODOS DIFERENTES PARA OBTER TRANSCRIÇÃO ========================

// Método 1: Piped API (gratuita, sem chave)
async function fetchFromPiped(videoId) {
    try {
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
    } catch(e) { return null; }
}

// Método 2: YouTube Transcript (gratuita, sem chave)
async function fetchFromYoutubeTranscript(videoId) {
    try {
        const response = await fetch(`https://youtube-transcript.vercel.app/api/transcript?videoId=${videoId}`);
        const data = await response.json();
        if (data && Array.isArray(data) && data.length > 0) {
            return data.map(segment => ({
                startTime: segment.start,
                text: segment.text
            }));
        }
        return null;
    } catch(e) { return null; }
}

// Método 3: LemnosLife API (gratuita, sem chave)
async function fetchFromLemnosLife(videoId) {
    try {
        const response = await fetch(`https://yt.lemnoslife.com/noKey?videoId=${videoId}`);
        const data = await response.json();
        if (data.captions && data.captions.length > 0) {
            const captionUrl = data.captions[0].url;
            const subResponse = await fetch(captionUrl);
            const subData = await subResponse.text();
            return parseSubtitleData(subData);
        }
        return null;
    } catch(e) { return null; }
}

// Método 4: YouTube API sem chave (método alternativo)
async function fetchFromNoKeyAPI(videoId) {
    try {
        const response = await fetch(`https://youtube-api.vercel.app/api/transcript/${videoId}`);
        const data = await response.json();
        if (data && data.transcript && data.transcript.length > 0) {
            return data.transcript.map(segment => ({
                startTime: segment.start,
                text: segment.text
            }));
        }
        return null;
    } catch(e) { return null; }
}

// Método 5: Outro serviço alternativo
async function fetchFromAlternativeAPI(videoId) {
    try {
        const response = await fetch(`https://youtube-transcript-api.p.rapidapi.com/transcript?video_id=${videoId}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0'
            }
        });
        if (response.ok) {
            const data = await response.json();
            if (data && data.length > 0) {
                return data.map(segment => ({
                    startTime: segment.start,
                    text: segment.text
                }));
            }
        }
        return null;
    } catch(e) { return null; }
}

// Método 6: Serviço do YouTube diretamente (scraping)
async function fetchFromDirectYouTube(videoId) {
    try {
        const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
        const html = await response.text();
        
        // Busca pela URL das legendas no HTML
        const match = html.match(/"captionTracks":\[\{"baseUrl":"([^"]+)"/);
        if (match && match[1]) {
            const transcriptUrl = match[1].replace(/\\u0026/g, '&');
            const subResponse = await fetch(transcriptUrl);
            const subData = await subResponse.text();
            return parseSubtitleData(subData);
        }
        return null;
    } catch(e) { return null; }
}

// Função principal que tenta todos os métodos
async function fetchTranscript(videoId) {
    const methods = [
        { name: 'Piped API', fn: fetchFromPiped },
        { name: 'YouTube Transcript', fn: fetchFromYoutubeTranscript },
        { name: 'LemnosLife', fn: fetchFromLemnosLife },
        { name: 'NoKey API', fn: fetchFromNoKeyAPI },
        { name: 'Alternative API', fn: fetchFromAlternativeAPI },
        { name: 'Direct YouTube', fn: fetchFromDirectYouTube }
    ];
    
    for (const method of methods) {
        try {
            console.log(`Tentando: ${method.name}...`);
            const result = await method.fn(videoId);
            if (result && result.length > 0) {
                console.log(`✅ Sucesso com ${method.name}! ${result.length} frases`);
                return result;
            }
        } catch (e) {
            console.log(`❌ ${method.name} falhou:`, e.message);
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
            error: 'Este vídeo não possui legendas disponíveis em nenhuma das 6 fontes'
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
