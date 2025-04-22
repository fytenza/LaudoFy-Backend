const Paciente = require('../models/Paciente');
const AuditLog = require('../models/AuditModel');
const { encrypt, decrypt } = require('../utils/crypto');
const { maskSensitiveData } = require('../utils/helpers');
const mongoose = require('mongoose');

// Helper para descriptografar um paciente
function decryptPaciente(paciente) {
    const result = paciente.toObject ? paciente.toObject() : paciente;
    
    // Garante que campos opcionais sejam tratados corretamente
    return {
        ...result,
        cpf: result.cpf || null,
        dataNascimento: result.dataNascimento || null,
        endereco: result.endereco || null,
        telefone: result.telefone || null
    };
}

// Criar um novo paciente
exports.criarPaciente = async (req, res) => {
    try {
        const { nome, cpf, dataNascimento, endereco, telefone, email } = req.body;
        
        if (!nome || !cpf || !dataNascimento || !endereco || !telefone) {
            return res.status(400).json({ 
                success: false,
                erro: 'Todos os campos obrigatórios devem ser preenchidos' 
            });
        }

        // Verifica se o CPF já está cadastrado (usando criptografia)
        const cpfCriptografado = encrypt(cpf.replace(/\D/g, ''));
        const cpfExistente = await Paciente.findOne({ cpf: cpfCriptografado });
        if (cpfExistente) {
            return res.status(409).json({ 
                success: false,
                erro: 'CPF já cadastrado' 
            });
        }

        const paciente = new Paciente({ 
            nome: nome.trim(),
            cpf: cpf.replace(/\D/g, ''), // Será criptografado pelo setter
            dataNascimento: new Date(dataNascimento).toISOString().split('T')[0], // Será criptografado
            endereco: endereco.trim(), // Será criptografado
            telefone: telefone.replace(/\D/g, ''), // Será criptografado
            email: email ? email.toLowerCase().trim() : null
        });

        await paciente.save();

        // Auditoria com dados mascarados
        await AuditLog.create({
            userId: req.usuarioId,
            action: 'create',
            description: `Novo paciente registrado: ${nome}`,
            collectionName: 'pacientes',
            documentId: paciente._id,
            before: null,
            after: maskSensitiveData(decryptPaciente(paciente), ['cpf', 'email', 'telefone']),
            ip: req.ip,
            userAgent: req.headers['user-agent'],
            timestamp: new Date()
        });

        return res.status(201).json({
            success: true,
            paciente: maskSensitiveData(decryptPaciente(paciente), ['cpf', 'email', 'telefone'])
        });

    } catch (err) {
        console.error('Erro ao criar paciente:', err);
        return res.status(500).json({ 
            success: false,
            erro: 'Erro ao processar a requisição',
            detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
};

// Listar pacientes com dados descriptografados
exports.listarPacientes = async (req, res) => {
    try {
        const { nome, cpf } = req.query;
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);
        
        const filtro = {};
        if (nome) filtro.nome = new RegExp(nome, 'i');
        if (cpf) {
            const cleanedCPF = cpf.replace(/\D/g, '');
            if (cleanedCPF.length === 11) {
                filtro.cpf = encrypt(cleanedCPF);
            }
        }

        const pacientes = await Paciente.find(filtro)
            .limit(limit)
            .sort({ nome: 1 });

        res.status(200).json(pacientes);
    } catch (err) {
        console.error('Erro ao listar pacientes:', err);
        res.status(500).json({ 
            success: false,
            error: 'Erro ao processar a requisição'
        });
    }
};

// Obter paciente por ID
exports.obterPaciente = async (req, res) => {
    try {
        const paciente = await Paciente.findById(req.params.id);
        if (!paciente) {
            return res.status(404).json({ error: 'Paciente não encontrado' });
        }
        res.status(200).json(paciente);
    } catch (err) {
        console.error('Erro ao obter paciente:', err);
        res.status(500).json({ 
            error: 'Erro interno no servidor'
        });
    }
};

// Atualizar paciente (já atualizado para usar descriptografia)
exports.atualizarPaciente = async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ erro: 'ID inválido' });
        }

        const pacienteAntes = await Paciente.findById(id);
        if (!pacienteAntes) {
            return res.status(404).json({ erro: 'Paciente não encontrado' });
        }

        // Verifica se está tentando modificar campos imutáveis
        if (req.body.cpf && req.body.cpf !== decrypt(pacienteAntes.cpf)) {
            return res.status(403).json({ erro: 'CPF não pode ser alterado' });
        }

        const camposPermitidos = ['nome', 'dataNascimento', 'endereco', 'telefone', 'email'];
        const atualizacao = {};
        
        camposPermitidos.forEach(campo => {
            if (req.body[campo] !== undefined) {
                if (campo === 'email' && req.body[campo]) {
                    atualizacao[campo] = req.body[campo].toLowerCase().trim();
                } else {
                    atualizacao[campo] = req.body[campo];
                }
            }
        });

        const pacienteAtualizado = await Paciente.findByIdAndUpdate(id, atualizacao, {
            new: true,
            runValidators: true,
        });

        await AuditLog.create({
            userId: req.usuarioId,
            action: 'update',
            description: `Paciente atualizado: ${pacienteAtualizado.nome}`,
            collectionName: 'pacientes',
            documentId: id,
            before: maskSensitiveData(decryptPaciente(pacienteAntes), ['cpf', 'email', 'telefone']),
            after: maskSensitiveData(decryptPaciente(pacienteAtualizado), ['cpf', 'email', 'telefone']),
            ip: req.ip,
            userAgent: req.headers['user-agent'],
            timestamp: new Date()
        });

        res.status(200).json({
            success: true,
            paciente: maskSensitiveData(decryptPaciente(pacienteAtualizado), ['cpf', 'email', 'telefone'])
        });

    } catch (err) {
        console.error('Erro ao atualizar paciente:', err);
        res.status(500).json({ 
            success: false,
            erro: 'Erro ao processar a requisição',
            detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
};

// Deletar paciente
exports.deletarPaciente = async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ erro: 'ID inválido' });
        }

        const paciente = await Paciente.findById(id);
        if (!paciente) {
            return res.status(404).json({ erro: 'Paciente não encontrado' });
        }

        const laudosCount = await Laudo.countDocuments({ pacienteId: id });
        if (laudosCount > 0) {
            return res.status(403).json({ 
                erro: 'Não é possível excluir paciente com laudos associados' 
            });
        }

        await Paciente.findByIdAndDelete(id);

        await AuditLog.create({
            userId: req.usuarioId,
            action: 'delete',
            description: `Paciente removido: ${paciente.nome}`,
            collectionName: 'pacientes',
            documentId: id,
            before: maskSensitiveData(decryptPaciente(paciente), ['cpf', 'email', 'telefone']),
            after: null,
            ip: req.ip,
            userAgent: req.headers['user-agent'],
            timestamp: new Date()
        });

        res.status(200).json({ 
            success: true,
            mensagem: 'Paciente deletado com sucesso' 
        });
    } catch (err) {
        console.error('Erro ao deletar paciente:', err);
        res.status(500).json({ 
            erro: 'Erro interno no servidor',
            detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
};