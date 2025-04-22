const Exame = require('../models/Exame');
const Paciente = require('../models/Paciente'); // Importar o modelo de Paciente
const fs = require('fs');
const path = require('path');
const { body, validationResult } = require('express-validator');
const logger = require('../utils/logger');
const Laudo = require('../models/Laudo');
const AuditLog = require('../models/AuditModel')
const { encrypt, decrypt } = require('../utils/crypto');
const { gerarThumbnailPDF } = require('../utils/pdfToThumbnail');

const { uploadPDFToUploadcare } = require('../services/uploadcareService.js');
const { gerarThumbnailPDFRemoto } = require('../utils/pdfUtils.js');
const { v4: uuidv4 } = require('uuid');

// Função para calcular a idade com base na data de nascimento
const calcularIdade = (dataNascimento) => {
    const hoje = new Date();
    const nascimento = new Date(dataNascimento);
    let idade = hoje.getFullYear() - nascimento.getFullYear();
    const mes = hoje.getMonth() - nascimento.getMonth();
    if (mes < 0 || (mes === 0 && hoje.getDate() < nascimento.getDate())) {
        idade--;
    }
    return idade;
};

// Validações para criação de exame
exports.validarExame = [
    body('paciente').notEmpty().withMessage('O nome do paciente é obrigatório'),
    body('tipoExame').isIn(['ECG', 'Holter', 'Ergometria', 'Outro']).withMessage('Tipo de exame inválido'),
    body('sintomas').notEmpty().withMessage('Os sintomas são obrigatórios'),
    body('segmentoPR').optional().isFloat({ gt: 0 }).withMessage('O segmento PR deve ser um número positivo'),
    body('frequenciaCardiaca').optional().isFloat({ gt: 0 }).withMessage('A frequência cardíaca deve ser um número positivo'),
    body('duracaoQRS').optional().isFloat({ gt: 0 }).withMessage('A duração do QRS deve ser um número positivo'),
    body('eixoMedioQRS').optional().isFloat().withMessage('O eixo médio do QRS deve ser um número válido'),
    body('altura').optional().isFloat({ gt: 0 }).withMessage('A altura deve ser um número positivo'),
    body('peso').optional().isFloat({ gt: 0 }).withMessage('O peso deve ser um número positivo'),
];

exports.uploadExame = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ erro: 'Nenhum arquivo enviado' });
    }

    const pdfPath = req.file.path;
    const thumbnailDir = path.join(__dirname, '../../uploads/thumbnails');
    
    // Criar diretório de thumbnails se não existir
    if (!fs.existsSync(thumbnailDir)) {
        fs.mkdirSync(thumbnailDir, { recursive: true });
    }

    const thumbnailPath = path.join(thumbnailDir, `thumbnail_${req.file.filename.replace('.pdf', '.png')}`);

    try {
        await gerarThumbnailPDF(pdfPath, thumbnailPath);
        res.status(200).json({ 
            mensagem: 'PDF e thumbnail processados com sucesso',
            thumbnailPath: `uploads/thumbnails/${path.basename(thumbnailPath)}`
        });
    } catch (err) {
        console.error('Erro ao gerar thumbnail:', err);
        
        // Tentar limpar arquivos em caso de erro
        try {
            if (fs.existsSync(thumbnailPath)) {
                fs.unlinkSync(thumbnailPath);
            }
        } catch (cleanupErr) {
            console.error('Erro ao limpar arquivos:', cleanupErr);
        }
        
        res.status(500).json({ 
            erro: 'Falha na geração de thumbnail',
            detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
};

// Criar um novo exame com upload de arquivo
exports.criarExame = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ erros: errors.array() });
        }

        const {
            paciente, tipoExame, sintomas, segmentoPR,
            frequenciaCardiaca, duracaoQRS, eixoMedioQRS,
            altura, peso
        } = req.body;

        if (!req.file) {
            logger.error('Arquivo não enviado');
            return res.status(400).json({ erro: 'Arquivo não enviado' });
        }

        const pacienteInfo = await Paciente.findById(paciente);
        if (!pacienteInfo) {
            logger.error('Paciente não encontrado');
            return res.status(404).json({ erro: 'Paciente não encontrado' });
        }

        const usuarioId = req.usuarioId;

        const validarEnum = (valor, campo, valoresPermitidos) => {
            if (!valoresPermitidos.map(v => v.toLowerCase()).includes(String(valor).toLowerCase())) {
                throw new Error(`${campo} inválido: ${valor}. Valores permitidos: ${valoresPermitidos.join(', ')}`);
            }
        };

        validarEnum(req.body.tipoExame, 'tipoExame', ['ECG', 'Holter', 'Ergometria', 'Outro']);
        validarEnum(req.body.status || 'Pendente', 'status', ['Pendente', 'Concluído', 'Laudo realizado']);

        // ⬆️ Upload PDF pro Uploadcare
        const arquivoURL = await uploadPDFToUploadcare(req.file);

        const exame = new Exame({
            ...req.body,
            arquivo: arquivoURL,
            tecnico: usuarioId,
            status: req.body.status || 'Pendente'
        });

        await exame.save();

        await AuditLog.create({
            userId: usuarioId,
            action: 'create',
            description: `Novo exame criado para o paciente ${pacienteInfo.nome} (${pacienteInfo.cpf})`,
            collectionName: 'exames',
            documentId: exame._id,
            before: null,
            after: exame.toObject(),
            ip: req.ip,
            userAgent: req.headers['user-agent'],
            additionalInfo: {
                tipoExame,
                arquivo: arquivoURL,
                pacienteNome: pacienteInfo.nome,
                pacienteId: pacienteInfo._id
            }
        });

        res.status(201).json({
            success: true,
            exame: exame.toObject()
        });

    } catch (err) {
        logger.error(`Erro ao criar exame: ${err.message}`);

        await AuditLog.create({
            userId: req.usuarioId || null,
            action: 'create',
            description: 'Falha ao tentar criar exame',
            collectionName: 'exames',
            documentId: null,
            before: null,
            after: null,
            ip: req.ip,
            userAgent: req.headers['user-agent'],
            error: err.message,
            status: 'failed'
        });

        res.status(400).json({
            success: false,
            erro: err.message || 'Erro ao criar exame'
        });
    }
};

// Listar todos os exames com filtros e paginação
exports.listarExames = async (req, res) => {
    try {
        const { paciente, tipoExame, status, page = 1, limit = 10 } = req.query;
        const filtro = {};

        // Aplicar filtros
        if (paciente) {
            const pacientes = await Paciente.find({ nome: { $regex: paciente, $options: 'i' } });
            filtro.paciente = { $in: pacientes.map(p => p._id) };
        }
        
        // Para campos criptografados, usamos uma abordagem diferente
        if (tipoExame) {
            // Busca aproximada - alternativa 1 (menos performática)
            const examesComTipo = await Exame.find({}).select('tipoExame');
            const idsFiltrados = examesComTipo
                .filter(e => decrypt(e.tipoExame).toLowerCase().includes(tipoExame.toLowerCase()))
                .map(e => e._id);
            
            filtro._id = { $in: idsFiltrados };
        }
        
        if (status) {
            // Busca aproximada - alternativa 1 (menos performática)
            const examesComStatus = await Exame.find({}).select('status');
            const idsFiltrados = examesComStatus
                .filter(e => decrypt(e.status).toLowerCase().includes(status.toLowerCase()))
                .map(e => e._id);
            
            if (filtro._id) {
                // Interseção com filtro anterior
                filtro._id.$in = filtro._id.$in.filter(id => idsFiltrados.includes(id));
            } else {
                filtro._id = { $in: idsFiltrados };
            }
        }

        // Converter page e limit para números
        const pagina = parseInt(page);
        const limite = parseInt(limit);

        // Buscar exames com paginação
        const exames = await Exame.find(filtro)
            .populate('paciente', 'nome dataNascimento')
            .populate('tecnico', 'nome')
            .sort({ dataExame: -1 })
            .skip((pagina - 1) * limite)
            .limit(limite);

        // Processar os exames (os getters já serão aplicados pelo transform no schema)
        const examesProcessados = exames.map(exame => exame.toObject());

        // Contar o total de exames
        const totalExames = await Exame.countDocuments(filtro);

        res.status(200).json({
            exames: examesProcessados,
            paginaAtual: pagina,
            totalPaginas: Math.ceil(totalExames / limite),
            totalExames,
        });
    } catch (err) {
        console.error("Erro ao listar exames:", err);
        res.status(500).json({ 
            erro: 'Erro interno ao listar exames',
            detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
};

// Obter um exame por ID
exports.obterExame = async (req, res) => {
    try {
        const exame = await Exame.findById(req.params.id)
            .populate('paciente', 'nome dataNascimento') // Popula o nome e a data de nascimento do paciente
            .populate('tecnico', 'nome');

        if (!exame) {
            return res.status(404).json({ erro: 'Exame não encontrado' });
        }

        // Calcular a idade do paciente
        const idade = calcularIdade(exame.paciente.dataNascimento);
        const exameComIdade = { ...exame.toObject(), idade };

        res.status(200).json(exameComIdade);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
};

// Atualizar um exame
exports.atualizarExame = async (req, res) => {
    try {
        const exame = await Exame.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
            runValidators: true,
        }).populate('paciente', 'nome dataNascimento');

        if (!exame) {
            return res.status(404).json({ erro: 'Exame não encontrado' });
        }

        // Calcular a idade do paciente
        const idade = calcularIdade(exame.paciente.dataNascimento);
        const exameComIdade = { ...exame.toObject(), idade };

        res.status(200).json(exameComIdade);
    } catch (err) {
        res.status(400).json({ erro: err.message });
    }
};

// Deletar um exame
exports.deletarExame = async (req, res) => {
    try {
        const exame = await Exame.findByIdAndDelete(req.params.id);
        if (!exame) {
            return res.status(404).json({ erro: 'Exame não encontrado' });
        }
        res.status(200).json({ mensagem: 'Exame deletado com sucesso' });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
};

// Download do arquivo de um exame
exports.downloadArquivo = async (req, res) => {
    try {
        const exame = await Exame.findById(req.params.id);
        if (!exame || !exame.arquivo) {
            return res.status(404).json({ erro: 'Arquivo não encontrado' });
        }

        // Agora a URL está no campo `arquivo`
        return res.redirect(exame.arquivo);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
};


// Listar exames para seleção
exports.listarExamesParaSelecao = async (req, res) => {
    try {
        const { paciente, tipoExame } = req.query;
        const filtro = {};

        if (paciente) {
            filtro.paciente = new RegExp(paciente, 'i');
        }
        if (tipoExame) {
            filtro.tipoExame = tipoExame;
        }

        const exames = await Exame.find(filtro).select('_id paciente tipoExame status');
        res.status(200).json(exames);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
};

// Listar exames sem laudo
exports.listarExamesSemLaudo = async (req, res) => {
    try {
        const laudos = await Laudo.find().select('exame');
        const examesComLaudo = laudos.map((laudo) => laudo.exame.toString());

        const examesSemLaudo = await Exame.find({ _id: { $nin: examesComLaudo } }).select(
            '_id paciente tipoExame status'
        );

        res.status(200).json(examesSemLaudo);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
};