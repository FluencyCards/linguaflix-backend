import express from 'express';
import cors from 'cors';
import { google } from 'googleapis';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Inicializa o cliente da API do YouTube
const youtube = google.youtube({
    version: 'v3',
    auth: process.env.YOUTUBE_API_KEY // Sua chave de API
});

// Converte timestamp "00:00:00.000" para segundos
function timestampToSeconds(timestamp) {
    const parts = timestamp.split(':');
    if (parts.length === 3) {
        return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
    } else if (parts.length === 2) {
        return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
    }
    return 0;
}

// Faz o parse do XML de legendas
function parseXMLCaption(xmlContent) {
    const segments = [];
    // Regex simples para extrair texto e start time do XML
    const regex = /<text start="([^"]+)"[^>]*>([^<]+)<\/text>/g;
    let match;
    
    while ((match = regex.exec(xmlContent)) !== null) {
        const startTime = parseFloat(match[1]);
        const text = match[2].trim();
        if (text) {
            segments.push({ startTime, text });
        }
    }
    
    return segments;
}

// ======================== MÉTODO 1: ENDPOINT GRATUITO (RECOMENDADO) ========================
// Não gasta cota! Funciona para qualquer vídeo com legendas em inglês
async function fetchFromFreeEndpoint(videoId) {
    try {
        // Tenta inglês primeiro
        let response = await fetch(`https://video.google.com/timedtext?lang=en&v=${videoId}`);
        
        // Se não achar, tenta português
        if (!response.ok) {
            response = await fetch(`https://video.google.com/timedtext?lang=pt&v=${videoId}`);
        }
        
        if (response.ok) {
            const xmlContent = await response.text();
            const segments = parseXMLCaption(xmlContent);
            
            if (segments && segments.length > 0) {
                console.log(`✅ Endpoint gratuito: ${segments.length} frases`);
                return segments;
            }
        }
        return null;
    } catch(e) {
        console.log("Endpoint gratuito falhou:", e.message);
        return null;
    }
}

// ======================== MÉTODO 2: API OFICIAL (FALLBACK) ========================
// Gasta cota, mas é confiável para vídeos com legendas oficiais
async function fetchFromOfficialAPI(videoId) {
    try {
        // 1. Busca informações do vídeo (1 unidade)
        const videoResponse = await youtube.videos.list({
            part: ['snippet', 'contentDetails'],
            id: [videoId]
        });
        
        if (!videoResponse.data.items || videoResponse.data.items.length === 0) {
            return null;
        }
        
        // 2. Busca lista de legendas disponíveis (50 unidades)
        const captionsResponse = await youtube.captions.list({
            part: ['snippet'],
            videoId: videoId
        });
        
        if (!captionsResponse.data.items || captionsResponse.data.items.length === 0) {
            return null;
        }
        
        // Procura legenda em inglês
        const englishCaption = captionsResponse.data.items.find(
            cap => cap.snippet.language === 'en'
        );
        
        if (!englishCaption || !englishCaption.id) {
            return null;
        }
        
        // 3. Tenta baixar a legenda (200 unidades - cuidado!)
        // Nota: Isso pode falhar se o usuário não for o dono do vídeo
        try {
            const downloadUrl = `https://www.googleapis.com/youtube/v3/captions/${englishCaption.id}?key=${process.env.YOUTUBE_API_KEY}`;
            const subResponse = await fetch(downloadUrl);
            const subData = await subResponse.text();
            
            return parseXMLCaption(subData);
        } catch(e) {
            console.log("Download via API falhou:", e.message);
            return null;
        }
        
    } catch(e) {
        console.log("API oficial falhou:", e.message);
        return null;
    }
}

// ======================== MÉTODO 3: PIPED API (ÚLTIMO FALLBACK) ========================
async function fetchFromPipedAPI(videoId) {
    try {
        const response = await fetch(`https://pipedapi.kavin.rocks/videos/${videoId}`);
        if (!response.ok) return null;
        const data = await response.json();
        
        if (data.subtitles && data.subtitles.length > 0) {
            const subtitle = data.subtitles.find(s => s.code === 'en');
            if (subtitle && subtitle.url) {
                const subResponse = await fetch(subtitle.url);
                const subData = await subResponse.text();
                return parseXMLCaption(subData);
            }
        }
        return null;
    } catch(e) {
        return null;
    }
}

// Endpoint principal
app.get('/api/transcript', async (req, res) => {
    const videoId = req.query.videoId;
    
    if (!videoId) {
        return res.status(400).json({ error: 'videoId é obrigatório' });
    }
    
    console.log(`Buscando transcrição para: ${videoId}`);
    
    try {
        // Tenta métodos em ordem (mais eficiente primeiro)
        let transcript = null;
        
        // Método 1: Endpoint gratuito (0 cota)
        transcript = await fetchFromFreeEndpoint(videoId);
        if (transcript && transcript.length > 0) {
            return res.json({ success: true, videoId, transcript });
        }
        
        // Método 2: API oficial (1 + 50 unidades)
        transcript = await fetchFromOfficialAPI(videoId);
        if (transcript && transcript.length > 0) {
            return res.json({ success: true, videoId, transcript });
        }
        
        // Método 3: Piped API (fallback)
        transcript = await fetchFromPipedAPI(videoId);
        if (transcript && transcript.length > 0) {
            return res.json({ success: true, videoId, transcript });
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
