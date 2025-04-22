const { default: mongoose } = require('mongoose');
const Usuario = require('../models/Usuario');
const AuditLog = require('../models/AuditModel');
const { encrypt } = require('../utils/crypto');
const { validationResult } = require('express-validator');
const validator = require('validator');

// Criar um novo usuário (apenas admins)
exports.criarUsuario = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ erro: 'Dados inválidos', detalhes: errors.array() });
        }

        const { nome, email, senha, role, crm } = req.body;

        if (!validator.isEmail(email)) {
            return res.status(400).json({ erro: 'Email inválido' });
        }

        if (!['admin', 'medico', 'tecnico'].includes(role)) {
            return res.status(400).json({ erro: 'Função de usuário inválida' });
        }

        // Verifica se o email já existe
        const usuarioExistente = await Usuario.findOne({ email });
        if (usuarioExistente) {
            return res.status(400).json({ erro: 'Email já cadastrado' });
        }

        const usuario = new Usuario({ nome, email, senha, role, crm });
        await usuario.save();

        const usuarioResponse = usuario.toObject();
        delete usuarioResponse.senha;
        delete usuarioResponse.refreshToken;
        delete usuarioResponse.resetSenhaToken;

        try {
            await AuditLog.create({
                userId: req.usuario?._id,
                action: 'create',
                description: `Novo usuário registrado: ${email}`,
                collectionName: 'usuarios',
                documentId: usuario._id,
                before: null,
                after: usuarioResponse,
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });
        } catch (auditError) {
            console.error('Erro ao criar log de auditoria:', auditError);
        }

        res.status(201).json({
            mensagem: 'Usuário criado com sucesso',
            usuario: usuarioResponse
        });

    } catch (err) {
        res.status(500).json({ erro: 'Erro interno ao criar usuário' });
    }
};

// Listar todos os usuários com paginação e filtros
exports.listarUsuarios = async (req, res) => {
    try {
        const { nome, email, role, dataInicio, dataFim, page = 1, limit = 10 } = req.query;
        const filtro = {};

        if (nome) filtro.nome = { $regex: nome, $options: 'i' };
        if (email) filtro.email = { $regex: email, $options: 'i' };
        if (role && ['admin', 'tecnico', 'medico'].includes(role)) filtro.role = role;

        if (dataInicio || dataFim) {
            filtro.createdAt = {};
            if (dataInicio) filtro.createdAt.$gte = new Date(dataInicio);
            if (dataFim) filtro.createdAt.$lte = new Date(dataFim);
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [usuarios, total] = await Promise.all([
            Usuario.find(filtro)
                .select('-senha -refreshToken -resetSenhaToken')
                .skip(skip)
                .limit(parseInt(limit))
                .sort({ createdAt: -1 }),
            Usuario.countDocuments(filtro)
        ]);

        return res.status(200).json({
            usuarios,
            total,
            totalPaginas: Math.ceil(total / limit),
            paginaAtual: parseInt(page),
            limite: parseInt(limit)
        });

    } catch (err) {
        return res.status(500).json({ 
            erro: 'Erro ao listar usuários',
            detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
};

// Obter um usuário específico pelo ID
exports.getUsuario = async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ erro: 'ID inválido' });
        }

        const usuario = await Usuario.findById(req.params.id)
            .select('-senha -refreshToken -resetSenhaToken');

        if (!usuario) {
            return res.status(404).json({ erro: 'Usuário não encontrado' });
        }

        res.status(200).json(usuario);
    } catch (err) {
        res.status(500).json({ erro: 'Erro ao buscar usuário' });
    }
};

// Atualizar um usuário
exports.atualizarUsuario = async (req, res) => {
    try {
        const { nome, email, role, senha, crm } = req.body;
        const usuarioId = req.params.id;

        if (!mongoose.Types.ObjectId.isValid(usuarioId)) {
            return res.status(400).json({ erro: 'ID inválido' });
        }

        const usuario = await Usuario.findById(usuarioId);
        if (!usuario) {
            return res.status(404).json({ erro: 'Usuário não encontrado' });
        }

        // Atualiza os campos com sanitização básica
        if (nome && typeof nome === 'string') usuario.nome = nome.trim();
        if (email && validator.isEmail(email)) usuario.email = email.trim();
        if (senha && senha.length >= 6) usuario.senha = senha;
        if (role && ['admin', 'medico', 'tecnico'].includes(role)) usuario.role = role;
        if (crm && typeof crm === 'string') usuario.crm = crm.trim();

        await usuario.save();

        const usuarioAtualizado = await Usuario.findById(usuarioId)
            .select('-senha -refreshToken -resetSenhaToken');

        res.status(200).json({
            mensagem: 'Usuário atualizado com sucesso',
            usuario: usuarioAtualizado
        });

        await AuditLog.create({
            userId: req.usuario?._id,
            action: 'update',
            description: `Usuário atualizado: ${email || usuario.email}`,
            collectionName: 'usuarios',
            documentId: usuario._id,
            before: null,
            after: usuarioAtualizado.toObject(),
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

    } catch (err) {
        res.status(500).json({ erro: 'Erro ao atualizar usuário' });
    }
};