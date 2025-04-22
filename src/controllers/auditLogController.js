const AuditLog = require('../models/AuditModel');
const { validationResult } = require('express-validator');

exports.listarAuditoria = async (req, res) => {
    try {
        // Validação dos parâmetros de consulta
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        // Extrai parâmetros da query string
        const { 
            page = 1, 
            limit = 20, 
            action, 
            collectionName, 
            userId, 
            documentId,
            startDate,
            endDate,
            status
        } = req.query;

        // Constrói o filtro de consulta
        const filter = {};
        
        if (action) filter.action = action;
        if (collectionName) filter.collectionName = collectionName;
        if (userId) filter.userId = userId;
        if (documentId) filter.documentId = documentId;
        if (status) filter.status = status;
        
        // Filtro por data
        if (startDate || endDate) {
            filter.createdAt = {};
            if (startDate) filter.timestamp.$gte = new Date(startDate);
            if (endDate) filter.timestamp.$lte = new Date(endDate);
        }

        // Opções para a consulta paginada
        // SEMPRE ordenar por createdAt em ordem decrescente
        const options = {
            page: parseInt(page),
            limit: parseInt(limit),
            sort: '-timestamp', // Ordem fixa: mais recente primeiro
            populate: {
                path: 'userId',
                select: 'nome email role'
            }
        };

        // Executa a consulta paginada
        const result = await AuditLog.paginate(filter, options);

        // Formata a resposta
        const response = {
            success: true,
            data: result.docs,
            pagination: {
                total: result.totalDocs,
                pages: result.totalPages,
                currentPage: result.page,
                itemsPerPage: result.limit,
                hasNext: result.hasNextPage,
                hasPrev: result.hasPrevPage
            }
        };

        res.status(200).json(response);

    } catch (err) {
        console.error('Erro ao listar auditoria:', err);
        res.status(500).json({ 
            success: false,
            erro: 'Erro ao listar registros de auditoria',
            detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
};

exports.obterDetalhesAuditoria = async (req, res) => {
    try {
        const { id } = req.params;

        const registro = await AuditLog.findById(id)
            .populate({
                path: 'userId',
                select: 'nome email role'
            });

        if (!registro) {
            return res.status(404).json({
                success: false,
                erro: 'Registro de auditoria não encontrado'
            });
        }

        res.status(200).json({
            success: true,
            data: registro
        });

    } catch (err) {
        console.error('Erro ao obter detalhes de auditoria:', err);
        res.status(500).json({ 
            success: false,
            erro: 'Erro ao obter detalhes do registro',
            detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
};