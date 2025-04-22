// routes/estatisticas.js
const express = require('express');
const router = express.Router();
const Laudo = require('../models/Laudo');
const Exame = require('../models/Exame');
const { decrypt } = require('../utils/crypto');

// Estatísticas Gerais
router.get('/estatisticas', async (req, res) => {
    try {
        // Primeiro obtenha todos os exames para processamento em memória
        const todosExames = await Exame.find().lean();
        
        // Processar os status manualmente
        let totalExames = 0;
        let examesPendentes = 0;
        let examesFinalizados = 0;
        
        todosExames.forEach(exame => {
            totalExames++;
            
            // Descriptografar o status
            let status;
            try {
                status = decrypt(exame.status);
            } catch (err) {
                status = exame.status; // Se falhar a descriptografia, usa o valor original
            }
            
            if (status === 'Pendente') examesPendentes++;
            if (status === 'Laudo realizado') examesFinalizados++;
        });

        // Calcular tempo médio de resposta
        const tempoMedioResposta = await Laudo.aggregate([
            {
                $match: {
                    dataFinalizacao: { $exists: true },
                    dataCriacao: { $exists: true }
                }
            },
            {
                $group: {
                    _id: null,
                    avgTime: { 
                        $avg: { 
                            $subtract: ["$dataFinalizacao", "$dataCriacao"] 
                        } 
                    }
                }
            }
        ]);

        res.json({
            totalExames,
            examesPendentes,
            examesFinalizados,
            tempoMedioResposta: tempoMedioResposta[0]?.avgTime || 0
        });
    } catch (err) {
        console.error('Erro ao obter estatísticas:', err);
        res.status(500).json({ 
            message: 'Erro ao processar estatísticas',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

// Distribuição de Tipos de Exame
router.get('/tipos-exames', async (req, res) => {
    try {
        // Primeiro obtemos todos os exames com os tipos descriptografados
        const exames = await Exame.find().select('tipoExame');
        
        // Processamos os dados em JavaScript para garantir a descriptografia
        const tiposContagem = exames.reduce((acc, exame) => {
            // Aplica a descriptografia manualmente
            let tipoDescriptografado;
            try {
                tipoDescriptografado = decrypt(exame.tipoExame);
                // Formata para capitalização correta (primeira letra maiúscula, resto minúsculas)
                tipoDescriptografado = tipoDescriptografado.charAt(0).toUpperCase() + 
                                      tipoDescriptografado.slice(1).toLowerCase();
            } catch (error) {
                // Se houver erro na descriptografia, usa o valor original
                tipoDescriptografado = exame.tipoExame;
            }
            
            // Contabiliza os tipos
            if (!acc[tipoDescriptografado]) {
                acc[tipoDescriptografado] = 0;
            }
            acc[tipoDescriptografado]++;
            return acc;
        }, {});
        
        // Converte o objeto em array no formato desejado
        const tipos = Object.entries(tiposContagem)
            .map(([tipo, count]) => ({ _id: tipo, count }))
            .sort((a, b) => b.count - a.count);
        
        res.json(tipos);
    } catch (err) {
        console.error('Erro ao obter distribuição de tipos de exame:', err);
        res.status(500).json({ 
            message: 'Erro ao processar tipos de exame',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

// Evolução Mensal
router.get('/evolucao-mensal', async (req, res) => {
    try {
        const evolucao = await Exame.aggregate([
            {
                $group: {
                    _id: {
                        year: { $year: "$dataExame" },
                        month: { $month: "$dataExame" }
                    },
                    total: { $sum: 1 },
                    concluidos: {
                        $sum: { $cond: [{ $eq: ["$status", "Laudo realizado"] }, 1, 0] }
                    }
                }
            },
            { $sort: { "_id.year": 1, "_id.month": 1 } },
            { $limit: 12 }
        ]);

        res.json(evolucao);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;