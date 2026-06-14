import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Função para converter timestamp para segundos
function timestampToSeconds(timestamp) {
    const parts = timestamp.split(':');
    if (parts.length === 3) {
        return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
    } else if (parts.length === 2) {
        return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
    }
    return 0;
}

// Função para parse de legendas no formato WebVTT
function parseWebVTT(content) {
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

// API principal usando o serviço mais confiável
app.get('/api/transcript', async (req, res) => {
    const videoId = req.query.videoId;
    
    if (!videoId) {
        return res.status(400).json({ error: 'videoId é obrigatório' });
    }
    
    console.log(`Buscando transcrição para: ${videoId}`);
    
    try {
        // Usando o serviço gratuito do YouTube Transcript (sem bloqueio)
        const response = await fetch(`https://youtubetranscript.com/?v=${videoId}`);
        
        if (response.ok) {
            const data = await response.text();
            // O retorno é XML/HTML, precisamos parsear
            const segments = parseWebVTT(data);
            
            if (segments && segments.length > 0) {
                console.log(`✅ Sucesso! ${segments.length} frases encontradas`);
                return res.json({
                    success: true,
                    videoId: videoId,
                    transcript: segments
                });
            }
        }
        
        // Fallback: usar outra fonte
        const fallbackResponse = await fetch(`https://yt.lemnoslife.com/noKey?videoId=${videoId}`);
        const fallbackData = await fallbackResponse.json();
        
        if (fallbackData.captions && fallbackData.captions.length > 0) {
            const captionUrl = fallbackData.captions[0].url;
            const subResponse = await fetch(captionUrl);
            const subData = await subResponse.text();
            const segments = parseWebVTT(subData);
            
            if (segments && segments.length > 0) {
                return res.json({
                    success: true,
                    videoId: videoId,
                    transcript: segments
                });
            }
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
