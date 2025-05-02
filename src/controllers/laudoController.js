const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const mongoose = require('mongoose');
const Laudo = require('../models/Laudo');
const Exame = require('../models/Exame');
const { sendMedicalReport } = require('../services/emailService');
const logger = require('../utils/logger');
const QRCode = require('qrcode')
const AuditLog = require('../models/AuditModel');
const Usuario = require('../models/Usuario');
const { uploadPDFToUploadcare } = require('../services/uploadcareService');

// Configurações de diretórios
const LAUDOS_DIR = path.join(__dirname, '../../laudos');
const LAUDOS_ASSINADOS_DIR = path.join(LAUDOS_DIR, 'assinado');
const LOGO_PATH = path.join(__dirname, '../assets/logo-png.png')
const LOGO_LAUDOFY = path.join(__dirname, '../assets/laudofy-logo.png')

// Criar diretórios se não existirem
try {
  [LAUDOS_DIR, LAUDOS_ASSINADOS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
} catch (err) {
  console.error('Could not create directories:', err);
  process.exit(1);
}

// Função auxiliar para calcular idade
function calcularIdade(dataNascimento) {
  const hoje = new Date();
  const nascimento = new Date(dataNascimento);
  let idade = hoje.getFullYear() - nascimento.getFullYear();
  const m = hoje.getMonth() - nascimento.getMonth();
  if (m < 0 || (m === 0 && hoje.getDate() < nascimento.getDate())) {
    idade--;
  }
  return idade;
}

exports.gerarPdfLaudo = async (laudoId, exame, tipoExame, medicoNome, medicoId, conclusao) => {
  try {
    // Busca o laudo no banco de dados
    const laudo = await Laudo.findById(laudoId).populate('exame');
    const laudoCompleto = await Laudo.findById(laudoId);
    if (!laudo) {
      throw new Error('Laudo não encontrado');
    }

    const usuarioMedico = await Usuario.findById(medicoId).populate('crm');
    const publicLink = `${process.env.FRONTEND_URL}/publico/${laudoId}`;
    
    // Gerar QR Code
    let qrCodeBuffer;
    try {
      qrCodeBuffer = await QRCode.toBuffer(publicLink, {
        width: 200,
        margin: 1,
        color: {
          dark: '#2E3A59',
          light: '#FFFFFF'
        }
      });
    } catch (qrError) {
      console.error('Erro ao gerar QR Code:', qrError);
      qrCodeBuffer = null;
    }

    // Criar PDF em memória
    const pdfBuffers = [];
    const doc = new PDFDocument({ 
      size: 'A4', 
      margin: 30,
      bufferPages: true
    });

    // Coletar buffers do PDF
    doc.on('data', (chunk) => pdfBuffers.push(chunk));

    // Estilos aprimorados
    const styles = {
      colors: {
        primary: '#2E3A59',
        secondary: '#4B6BFF',
        light: '#FFFFFF',
        dark: '#2E3A59',
        text: '#333333',
        gray: '#8F9BB3',
        signature: '#4B6BFF'
      },
      margins: {
        left: 40,
        right: 60,
        top: 50,
        bottom: 40,
        headerRight: 150
      },
      fonts: {
        header: 16,
        title: 14,
        section: 12,
        normal: 10,
        small: 8,
        label: 10
      },
      spacing: {
        section: 20,
        paragraph: 15,
        line: 5,
        afterImage: 20,
        imageHeight: 320
      }
    };

    // Função para adicionar cabeçalho em todas as páginas
    const addHeader = () => {
      doc.fillColor(styles.colors.primary)
         .rect(0, 0, doc.page.width, 80)
         .fill();

      // Logo (se existir)
      if (LOGO_PATH && fs.existsSync(LOGO_PATH)) {
        doc.image(LOGO_PATH, styles.margins.left, 15, { 
          height: 38
        });
      } else {
        doc.fillColor(styles.colors.light)
           .font('Helvetica-Bold')
           .fontSize(20)
           .text('LOGO', styles.margins.left, 30);
      }

      // Número do laudo e data
      const rightTextX = doc.page.width - styles.margins.headerRight;
      doc.fillColor(styles.colors.light)
         .font('Helvetica-Bold')
         .fontSize(styles.fonts.small)
         .text(`LAUDO #${laudo._id.toString().substring(0, 8)}`, 
           rightTextX, 20, { align: 'right', width: 100 })
         .font('Helvetica')
         .text(`Emitido em: ${new Date().toLocaleDateString('pt-BR')}`, 
           rightTextX, 40, { align: 'right', width: 100 });
    };

    // Adiciona cabeçalho na primeira página
    addHeader();

    // Adiciona imagem de fundo transparente (logo LaudoFy)
    if (LOGO_LAUDOFY && fs.existsSync(LOGO_LAUDOFY)) {
      doc.opacity(0.04); // Quase transparente
      doc.image(LOGO_LAUDOFY, doc.page.width / 2 - 200, doc.page.height / 2 - 200, {
        width: 400
      });
      doc.opacity(1); // Restaura opacidade para o conteúdo normal
    }


    // Título do laudo
    doc.fillColor(styles.colors.dark)
       .font('Helvetica-Bold')
       .fontSize(styles.fonts.title)
       .text(`LAUDO MÉDICO | ${exame.tipoExame || 'Exame'}`, 
         styles.margins.left, 100);

    // Linha divisória
    doc.moveTo(styles.margins.left, 125)
       .lineTo(doc.page.width - styles.margins.right, 125)
       .lineWidth(1)
       .stroke(styles.colors.gray);

    // Função auxiliar para formatar valores
    const formatValue = (value, suffix = '') => {
      if (value === undefined || value === null) return 'Não informado';
      return `${value}${suffix}`;
    };

    // Função para desenhar label + valor
    const drawLabelValue = (label, value, x, y) => {
      doc.fillColor(styles.colors.text)
         .font('Helvetica-Bold')
         .fontSize(styles.fonts.label)
         .text(label, x, y);
      
      doc.font('Helvetica')
         .fontSize(styles.fonts.normal)
         .text(value, x + doc.widthOfString(label) + 2, y);
      
      return y + 18;
    };

    // Seção de dados (2 colunas)
    let currentY = 140;

    // Coluna 1 - Dados do paciente
    let pacienteY = currentY;
    pacienteY = drawLabelValue('Nome: ', exame?.paciente?.nome || 'Não informado', styles.margins.left, pacienteY);
    pacienteY = drawLabelValue('CPF: ', exame?.paciente?.cpf || 'Não informado', styles.margins.left, pacienteY);
    pacienteY = drawLabelValue('Nascimento: ', exame?.paciente?.dataNascimento ? 
      new Date(exame.paciente.dataNascimento).toLocaleDateString('pt-BR') : 'Não informado', styles.margins.left, pacienteY);
    pacienteY = drawLabelValue('Idade: ', exame?.paciente?.dataNascimento ? 
      calcularIdade(exame.paciente.dataNascimento) + ' anos' : 'Não informado', styles.margins.left, pacienteY);
    pacienteY = drawLabelValue('Altura: ', formatValue(exame?.altura, ' cm'), styles.margins.left, pacienteY);
    pacienteY = drawLabelValue('Peso: ', formatValue(exame?.peso, ' kg'), styles.margins.left, pacienteY);

    // Coluna 2 - Dados do exame
    let exameY = currentY;
    const column2X = doc.page.width / 2;
    exameY = drawLabelValue('Data do Exame: ', exame?.dataExame ? 
      new Date(exame.dataExame).toLocaleDateString('pt-BR') : 'Não informado', column2X, exameY);
    exameY = drawLabelValue('Médico: ', medicoNome || 'Não informado', column2X, exameY);
    if (exame?.frequenciaCardiaca) {
      exameY = drawLabelValue('FC: ', formatValue(exame.frequenciaCardiaca, ' bpm'), column2X, exameY);
    }
    if (exame?.segmentoPR) {
      exameY = drawLabelValue('PR: ', formatValue(exame.segmentoPR, ' ms'), column2X, exameY);
    }
    if (exame?.duracaoQRS) {
      exameY = drawLabelValue('QRS: ', formatValue(exame.duracaoQRS, ' ms'), column2X, exameY);
    }

    currentY = Math.max(pacienteY, exameY) + styles.spacing.section;

    // Divisão antes da conclusão
    doc.moveTo(styles.margins.left, currentY)
       .lineTo(doc.page.width - styles.margins.right, currentY)
       .lineWidth(1)
       .stroke(styles.colors.gray);

    currentY += styles.spacing.section;

    // Seção de conclusão
    doc.fillColor(styles.colors.dark)
       .font('Helvetica-Bold')
       .fontSize(styles.fonts.section)
       .text('ANÁLISE E CONCLUSÃO', styles.margins.left, currentY);

    currentY += styles.spacing.paragraph;

    // Conclusão formatada
    const conclusaoParagrafos = conclusao?.split('\n') || ['Não informado'];
    conclusaoParagrafos.forEach(paragrafo => {
      if (paragrafo.trim().length > 0) {
        const height = doc.heightOfString(paragrafo, {
          width: doc.page.width - styles.margins.left - styles.margins.right,
          align: 'justify'
        });
        
        // Verifica se precisa de nova página
        if (currentY + height > doc.page.height - 100) {
          doc.addPage();
          currentY = styles.margins.top;
          addHeader();
        }
        
        doc.fillColor(styles.colors.text)
           .font('Helvetica')
           .fontSize(styles.fonts.normal)
           .text(paragrafo, styles.margins.left, currentY, {
             width: doc.page.width - styles.margins.left - styles.margins.right,
             align: 'justify',
             lineGap: styles.spacing.line
           });
        
        currentY += height + styles.spacing.paragraph;
      }
    });

    // Posição fixa na parte inferior da página
    const rodapeY = doc.page.height - 124;

    // ✍️ Assinatura centralizada
    const assinaturaLargura = 250;
    const assinaturaX = (doc.page.width - assinaturaLargura) / 2;

    doc.moveTo(assinaturaX, rodapeY)
      .lineTo(assinaturaX + assinaturaLargura, rodapeY)
      .lineWidth(1)
      .stroke(styles.colors.signature);

    doc.fillColor(styles.colors.dark)
      .font('Helvetica-Bold')
      .fontSize(styles.fonts.normal)
      .text(medicoNome || 'Dr. Médico Responsável', assinaturaX, rodapeY + 5, {
        width: assinaturaLargura,
        align: 'center'
      })
      .font('Helvetica')
      .text(`CRM ${usuarioMedico?.crm || 'Crm não registrado'}`, assinaturaX, rodapeY + 25, {
        width: assinaturaLargura,
        align: 'center'
      });

    // 🔗 Link público abaixo da assinatura
    const publicLinkY = rodapeY + 55;
    const codigoAcesso = laudoCompleto?.codigoAcesso || 'XXXX';
    const larguraTexto = doc.page.width - styles.margins.left - styles.margins.right;

    doc.fillColor(styles.colors.dark)
      .font('Helvetica')
      .fontSize(styles.fonts.normal)
      .text(`Acesse o laudo digital em: ${publicLink}`, styles.margins.left, publicLinkY, {
        width: larguraTexto,
        align: 'center'
      });

    doc.text(`e digite o código de acesso: ${codigoAcesso}`, styles.margins.left, publicLinkY + 15, {
      width: larguraTexto,
      align: 'center'
    });


    // Retornar uma Promise para lidar com a geração assíncrona
    return new Promise((resolve, reject) => {
      doc.on('end', async () => {
        try {
          // Juntar todos os chunks em um único buffer
          const pdfBuffer = Buffer.concat(pdfBuffers);
          
          // Criar um objeto de arquivo para o UploadCare
          const pdfFile = {
            buffer: pdfBuffer,
            originalname: `laudo_${laudoId}.pdf`,
            mimetype: 'application/pdf',
            size: pdfBuffer.length
          };

          // Upload para o UploadCare
          const uploadcareUrl = await uploadPDFToUploadcare(pdfFile);

          // Atualiza o laudo com a URL do UploadCare
          const updatedLaudo = await Laudo.findByIdAndUpdate(
            laudoId,
            {
              laudoOriginal: uploadcareUrl,
              status: 'Laudo realizado',
              updatedAt: new Date()
            },
            { new: true }
          );

          // Atualiza o exame
          await Exame.findByIdAndUpdate(
            exame._id,
            {
              status: 'Laudo realizado',
              updatedAt: new Date()
            }
          );

          logger.info(`PDF gerado e armazenado no UploadCare para o laudo ${laudoId}`);
          resolve({ 
            success: true, 
            fileUrl: uploadcareUrl,
            laudo: updatedLaudo
          });
        } catch (err) {
          logger.error(`Erro ao processar PDF do laudo ${laudoId}:`, err);
          reject(err);
        }
      });

      doc.on('error', (err) => {
        logger.error(`Erro na geração do PDF para o laudo ${laudoId}:`, err);
        reject(err);
      });

      doc.end();
    });

  } catch (err) {
    logger.error(`Erro no processo de geração do laudo ${laudoId}:`, err);
    throw err;
  }
};

// Download original report
exports.downloadLaudoOriginal = async (req, res) => {
  try {
    const laudo = await Laudo.findById(req.params.id);
    if (!laudo || !laudo.laudoOriginal) {
      return res.status(404).json({ erro: 'Laudo original não encontrado' });
    }
    
    const filePath = path.join(process.cwd(), laudo.laudoOriginal);
    res.download(filePath);
  } catch (err) {
    console.error('Erro ao baixar laudo original:', err);
    res.status(500).json({ erro: 'Erro ao baixar laudo' });
  }
};

// Download signed report
exports.downloadLaudoAssinado = async (req, res) => {
  try {
    const laudo = await Laudo.findById(req.params.id);
    
    if (!laudo) {
      return res.status(404).json({ erro: 'Laudo não encontrado' });
    }

    if (!laudo.laudoAssinado) {
      return res.status(404).json({ erro: 'Laudo assinado não disponível' });
    }

    const filePath = path.join(process.cwd(), laudo.laudoAssinado);
    
    // Verifica se o arquivo existe fisicamente
    if (!fs.existsSync(filePath)) {
      logger.error(`Arquivo não encontrado: ${filePath}`);
      return res.status(404).json({ erro: 'Arquivo do laudo assinado não encontrado no servidor' });
    }

    // Força o download do arquivo
    res.download(filePath, `laudo_assinado_${laudo._id}.pdf`);
    
  } catch (err) {
    logger.error(`Erro ao baixar laudo assinado: ${err.message}`);
    res.status(500).json({ 
      erro: 'Erro ao baixar laudo assinado',
      detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Renomeie a função para manter consistência
exports.uploadSignedLaudo = async (req, res) => {
  if (!req.file) {
    await AuditLog.create({
      userId: req.usuarioId,
      action: 'upload_signed',
      description: 'Tentativa de upload sem arquivo',
      collectionName: 'laudos',
      documentId: req.params.id,
      status: 'failed',
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });
    
    return res.status(400).json({ 
      erro: 'Nenhum arquivo enviado',
      detalhes: 'É necessário enviar o arquivo PDF assinado'
    });
  }

  const laudoId = req.params.id;

  try {
    const laudo = await Laudo.findById(laudoId)
      .populate({
        path: 'exame',
        populate: {
          path: 'paciente',
          select: 'nome email'
        }
      });
    
    if (!laudo) {
      await AuditLog.create({
        userId: req.usuarioId,
        action: 'upload_signed',
        description: 'Laudo não encontrado para upload',
        collectionName: 'laudos',
        documentId: laudoId,
        status: 'failed',
        ip: req.ip,
        userAgent: req.headers['user-agent']
      });
      
      return res.status(404).json({ 
        erro: 'Laudo não encontrado',
        detalhes: `Laudo com ID ${laudoId} não existe`
      });
    }

    if (laudo.valido && laudo.laudoAssinado) {
      await AuditLog.create({
        userId: req.usuarioId,
        action: 'upload_signed',
        description: 'Tentativa de substituir laudo já assinado',
        collectionName: 'laudos',
        documentId: laudo._id,
        before: laudo.toObject(),
        status: 'failed',
        ip: req.ip,
        userAgent: req.headers['user-agent']
      });
      
      return res.status(400).json({ 
        erro: 'Laudo já está assinado e válido',
        detalhes: 'Não é possível substituir um laudo já validado'
      });
    }

    // Estado anterior para auditoria
    const laudoAntes = laudo.toObject();

    // Upload para UploadCare
    const fileUrl = await uploadPDFToUploadcare(req.file);

    // Atualizar o laudo
    laudo.laudoAssinado = fileUrl;
    laudo.status = 'Laudo assinado';
    laudo.valido = true;
    laudo.dataAssinatura = new Date();

    laudo.historico.push({
      usuario: req.usuarioId,
      nomeUsuario: req.usuarioNome,
      acao: 'Assinatura',
      detalhes: 'Laudo assinado e validado',
      data: new Date()
    });

    await laudo.save();

    // Auditoria de sucesso
    await AuditLog.create({
      userId: req.usuarioId,
      action: 'upload_signed',
      description: `Laudo assinado para o paciente ${laudo.exame.paciente.nome}`,
      collectionName: 'laudos',
      documentId: laudo._id,
      before: laudoAntes,
      after: laudo.toObject(),
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      additionalInfo: {
        arquivoUrl: fileUrl,
        pacienteId: laudo.exame.paciente._id,
        exameId: laudo.exame._id
      }
    });

    res.status(200).json({
      mensagem: 'Laudo assinado e validado com sucesso',
      laudo: {
        _id: laudo._id,
        status: laudo.status,
        valido: laudo.valido,
        dataAssinatura: laudo.dataAssinatura,
        laudoAssinado: laudo.laudoAssinado
      }
    });

  } catch (err) {
    console.error('Erro no processo de upload:', err);
    
    await AuditLog.create({
      userId: req.usuarioId,
      action: 'upload_signed',
      description: 'Falha no upload de laudo assinado',
      collectionName: 'laudos',
      documentId: req.params.id,
      status: 'failed',
      error: err.message,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.status(500).json({
      erro: 'Erro ao processar laudo assinado',
      detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

exports.criarLaudo = async (req, res) => {
  let novoLaudo;
  try {
    const { exameId, conclusao } = req.body;
    const usuarioId = req.usuarioId;
    const usuarioNome = req.usuarioNome;

    // Validações básicas
    if (!exameId || !conclusao) {
      await AuditLog.create({
        userId: usuarioId,
        action: 'create',
        description: 'Tentativa de criar laudo sem dados obrigatórios',
        collectionName: 'laudos',
        status: 'failed',
        ip: req.ip,
        userAgent: req.headers['user-agent']
      });
      
      return res.status(400).json({ erro: 'Exame e conclusão são obrigatórios' });
    }

    // Busca o exame
    const exame = await Exame.findById(exameId)
      .populate('paciente')
      .populate('tipoExame');

    if (!exame) {
      await AuditLog.create({
        userId: usuarioId,
        action: 'create',
        description: 'Tentativa de criar laudo para exame inexistente',
        collectionName: 'laudos',
        status: 'failed',
        ip: req.ip,
        userAgent: req.headers['user-agent']
      });
      
      return res.status(404).json({ erro: 'Exame não encontrado' });
    }

    // Verifica laudo existente
    const laudoExistente = await Laudo.findOne({ exame: exameId, valido: true });
    if (laudoExistente) {
      await AuditLog.create({
        userId: usuarioId,
        action: 'create',
        description: 'Tentativa de criar laudo duplicado para exame',
        collectionName: 'laudos',
        documentId: laudoExistente._id,
        status: 'failed',
        ip: req.ip,
        userAgent: req.headers['user-agent']
      });
      
      return res.status(400).json({ erro: 'Já existe um laudo válido para este exame' });
    }
    const gerarCodigoAcesso = () => Math.floor(1000 + Math.random() * 9000).toString();
    const codigoAcesso = gerarCodigoAcesso();


    // Cria o laudo
    novoLaudo = new Laudo({
      exame: exameId,
      medicoResponsavel: usuarioNome,
      medicoResponsavelId: usuarioId,
      conclusao,
      status: 'Laudo realizado',
      valido: false,
      criadoPor: usuarioNome,
      criadoPorId: usuarioId,
      codigoAcesso
    });

    await novoLaudo.save();
    
    exame.status = 'Laudo realizado';
    exame.laudo = novoLaudo._id;
    await exame.save();

    // Auditoria de criação
    await AuditLog.create({
      userId: usuarioId,
      action: 'create',
      description: `Novo laudo criado para exame ${exameId}`,
      collectionName: 'laudos',
      documentId: novoLaudo._id,
      before: null,
      after: novoLaudo.toObject(),
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      additionalInfo: {
        pacienteId: exame.paciente._id,
        tipoExame: exame.tipoExame.nome
      }
    });

    // Gera o PDF (assíncrono)
    exports.gerarPdfLaudo(
      novoLaudo._id,
      exame,
      exame.tipoExame,
      usuarioNome,
      usuarioId,
      conclusao
    );

    res.status(201).json({
      mensagem: 'Laudo criado com sucesso (aguardando assinatura)',
      laudo: {
        id: novoLaudo._id,
        exame: exameId,
        status: novoLaudo.status,
        criadoEm: novoLaudo.createdAt
      },
      valido: false
    });

  } catch (err) {
    logger.error('Erro ao criar laudo:', err);
    
    if (novoLaudo?._id) {
      await Laudo.findByIdAndUpdate(novoLaudo._id, {
        status: 'Erro ao gerar PDF'
      });
    }

    // Auditoria de erro
    await AuditLog.create({
      userId: req.user?._id,
      action: 'create',
      description: 'Falha ao criar laudo',
      collectionName: 'laudos',
      status: 'failed',
      error: err.message,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.status(500).json({ 
      erro: 'Erro ao criar laudo',
      detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Listar todos os laudos
exports.listarLaudos = async (req, res) => {
  try {
    const { exame, medicoResponsavel, status, valido, page = 1, limit = 10, pacienteId } = req.query;

    const filtro = {};
    
    // Filtro principal: apenas laudos do paciente específico
    if (pacienteId) {
      filtro['exame.paciente'] = pacienteId;
    }
    
    // Filtros adicionais
    if (exame) filtro.exame = exame;
    if (medicoResponsavel) filtro.medicoResponsavel = new RegExp(medicoResponsavel, 'i');
    if (status) filtro.status = status;
    if (valido !== undefined) filtro.valido = valido === 'true';

    const pagina = parseInt(page);
    const limite = parseInt(limit);

    const laudos = await Laudo.find(filtro)
        .populate({
          path: 'exame',
          populate: {
              path: 'paciente',
              select: 'nome'
          }
        })
        .sort({ createdAt: -1 })
        .skip((pagina - 1) * limite)
        .limit(limite);

    const totalLaudos = await Laudo.countDocuments(filtro);

    res.status(200).json({
        laudos,
        paginaAtual: pagina,
        totalPaginas: Math.ceil(totalLaudos / limite),
        totalLaudos,
    });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
};


// Obter um laudo por ID
exports.obterLaudo = async (req, res) => {
  try {
    const laudo = await Laudo.findById(req.params.id)
      .populate('exame')
      .populate('laudoAnterior', 'id valido versao status')
      .populate('laudoSubstituto', 'id valido versao status');
    
    if (!laudo) {
      return res.status(404).json({ erro: 'Laudo não encontrado' });
    }

    // Adiciona informações sobre a validade do laudo
    const laudoComValidade = {
      ...laudo.toObject(),
      cadeiaValidade: {
        atual: {
          id: laudo._id,
          valido: laudo.valido,
          versao: laudo.versao
        },
        anterior: laudo.laudoAnterior ? {
          id: laudo.laudoAnterior._id,
          valido: laudo.laudoAnterior.valido,
          versao: laudo.laudoAnterior.versao,
          status: laudo.laudoAnterior.status
        } : null,
        substituto: laudo.laudoSubstituto ? {
          id: laudo.laudoSubstituto._id,
          valido: laudo.laudoSubstituto.valido,
          versao: laudo.laudoSubstituto.versao,
          status: laudo.laudoSubstituto.status
        } : null
      }
    };

    res.status(200).json(laudoComValidade);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
};

// Atualizar um laudo
exports.atualizarLaudo = async (req, res) => {
    try {
        const laudo = await Laudo.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
            runValidators: true,
        });
        if (!laudo) {
            return res.status(404).json({ erro: 'Laudo não encontrado' });
        }
        res.status(200).json(laudo);
    } catch (err) {
        res.status(400).json({ erro: err.message });
    }
};

// Deletar um laudo
exports.deletarLaudo = async (req, res) => {
    try {
        const laudo = await Laudo.findByIdAndDelete(req.params.id);
        if (!laudo) {
            return res.status(404).json({ erro: 'Laudo não encontrado' });
        }
        res.status(200).json({ mensagem: 'Laudo deletado com sucesso' });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
};


exports.getEstatisticas = async (req, res) => {
    try {
        console.log('Buscando estatísticas de laudos...');
        const totalLaudos = await Laudo.countDocuments();

        res.status(200).json({ totalLaudos });
    } catch (err) {
        console.error('Erro ao buscar estatísticas:', err);
        res.status(500).json({ erro: 'Erro ao buscar laudo', detalhes: err.message });
    }
};

exports.getLaudosPorStatus = async (req, res) => {
    try {
        const laudosPorStatus = await Laudo.aggregate([
            { $group: { _id: '$status', total: { $sum: 1 } } },
        ]);

        res.status(200).json(laudosPorStatus);
    } catch (err) {
        res.status(500).json({ message: 'Erro ao gerar relatório.' });
    }
};

exports.getLaudosPorExame = async (req, res) => {
  try {
    const laudos = await Laudo.find({ exame: req.params.id });
    res.json(laudos);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar laudos' });
  }
};

// Refazer um laudo existente
exports.refazerLaudo = async (req, res) => {
  try {
    const { id } = req.params;
    const { conclusao, motivo } = req.body;
    const usuarioId = req.usuarioId;
    const usuarioNome = req.usuarioNome;

    // Busca o laudo original
    const laudoOriginal = await Laudo.findById(id)
      .populate({
        path: 'exame',
        populate: { path: 'paciente tipoExame' }
      });
    
    if (!laudoOriginal) {
      await AuditLog.create({
        userId: usuarioId,
        action: 'recreate',
        description: 'Tentativa de refazer laudo inexistente',
        collectionName: 'laudos',
        documentId: id,
        status: 'failed',
        ip: req.ip,
        userAgent: req.headers['user-agent']
      });
      
      return res.status(404).json({ erro: 'Laudo original não encontrado' });
    }

    // Estado anterior para auditoria
    const laudoAntes = laudoOriginal.toObject();

    // Marca o laudo original como inválido
    laudoOriginal.valido = false;
    laudoOriginal.status = 'Laudo refeito';
    laudoOriginal.laudoSubstituto = null;
    laudoOriginal.motivoSubstituicao = motivo;
    laudoOriginal.atualizadoPor = usuarioNome;
    laudoOriginal.atualizadoPorId = usuarioId;

    // Cria novo laudo
    const novoLaudo = new Laudo({
      exame: laudoOriginal.exame._id,
      medicoResponsavel: usuarioNome,
      medicoResponsavelId: usuarioId,
      conclusao: conclusao || laudoOriginal.conclusao,
      status: 'Laudo realizado',
      versao: laudoOriginal.versao + 1,
      laudoAnterior: laudoOriginal._id,
      motivoRefacao: motivo,
      criadoPor: usuarioNome,
      criadoPorId: usuarioId,
      valido: false
    });

    laudoOriginal.laudoSubstituto = novoLaudo._id;
    const exame = laudoOriginal.exame;
    exame.laudo = novoLaudo._id;

    await novoLaudo.save();
    await laudoOriginal.save();
    await exame.save();

    // Auditoria de refação
    await AuditLog.create({
      userId: usuarioId,
      action: 'recreate',
      description: `Laudo refeito - Motivo: ${motivo}`,
      collectionName: 'laudos',
      documentId: novoLaudo._id,
      before: laudoAntes,
      after: novoLaudo.toObject(),
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      additionalInfo: {
        laudoAnterior: laudoOriginal._id,
        versaoAnterior: laudoOriginal.versao,
        pacienteId: exame.paciente._id
      }
    });

    // Gera PDF de forma assíncrona
    exports.gerarPdfLaudo(novoLaudo._id, exame, exame.tipoExame, usuarioNome, usuarioId, conclusao)
      .catch(err => logger.error('Erro ao gerar PDF:', err));

    res.status(201).json({
      mensagem: 'Laudo refeito com sucesso',
      laudo: {
        _id: novoLaudo._id,
        status: novoLaudo.status,
        versao: novoLaudo.versao,
        valido: novoLaudo.valido,
        exame: {
          _id: exame._id,
          tipoExame: exame.tipoExame
        },
        medicoResponsavel: novoLaudo.medicoResponsavel,
        conclusao: novoLaudo.conclusao,
        createdAt: novoLaudo.createdAt
      }
    });

  } catch (err) {
    logger.error('Erro ao refazer laudo:', err);
    
    await AuditLog.create({
      userId: req.user?._id,
      action: 'recreate',
      description: 'Falha ao refazer laudo',
      collectionName: 'laudos',
      documentId: req.params.id,
      status: 'failed',
      error: err.message,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.status(500).json({ 
      erro: 'Erro ao refazer laudo',
      detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Obter histórico de um laudo
exports.obterHistoricoLaudo = async (req, res) => {
  try {
    const { id } = req.params;

    const laudo = await Laudo.findById(id)
      .populate('laudoAnterior')
      .populate('laudosSubsequentes')
      .exec();

    if (!laudo) {
      return res.status(404).json({ erro: 'Laudo não encontrado' });
    }

    // Construir cadeia de versões
    const historicoCompleto = [];
    let laudoAtual = laudo;

    // Adicionar versões mais recentes primeiro
    while (laudoAtual) {
      historicoCompleto.unshift({
        id: laudoAtual._id,
        versao: laudoAtual.versao,
        data: laudoAtual.createdAt,
        status: laudoAtual.status,
        medico: laudoAtual.medicoResponsavel,
        motivo: laudoAtual.motivoRefacao
      });
      
      // Verificar se há uma versão anterior
      if (laudoAtual.laudoAnterior) {
        await laudoAtual.populate('laudoAnterior').execPopulate();
        laudoAtual = laudoAtual.laudoAnterior;
      } else {
        laudoAtual = null;
      }
    }

    res.status(200).json({
      laudoAtual: laudo,
      historico: historicoCompleto,
      alteracoes: laudo.historico
    });
  } catch (err) {
    res.status(500).json({ 
      erro: 'Erro ao obter histórico do laudo',
      detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

exports.getHistoricoLaudo = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Busca o laudo atual e todas as versões relacionadas
    const historicoCompleto = await Laudo.find({
      $or: [
        { _id: id },
        { laudoAnterior: id },
        { laudoSubstituto: id }
      ]
    })
    .sort({ versao: 1 }) // Ordena por versão (crescente)
    .populate({
      path: 'exame',
      populate: { path: 'paciente', select: 'nome' }
    })
    .populate('laudoAnterior', 'versao status')
    .populate('laudoSubstituto', 'versao status')
    .lean(); // Converte para objeto JavaScript puro

    // Para cada laudo, formatamos o histórico de ações
    const historicoFormatado = historicoCompleto.map(laudo => {
      return {
        _id: laudo._id,
        versao: laudo.versao,
        status: laudo.status,
        dataCriacao: laudo.createdAt,
        medicoResponsavel: laudo.medicoResponsavel,
        laudoAnterior: laudo.laudoAnterior,
        laudoSubstituto: laudo.laudoSubstituto,
        motivoRefacao: laudo.motivoRefacao,
        historico: laudo.historico.map(registro => ({
          data: registro.data,
          acao: registro.acao,
          usuario: registro.nomeUsuario || registro.usuario,
          statusEnvio: registro.statusEnvio,
          destinatarioEmail: registro.destinatarioEmail,
          mensagemErro: registro.mensagemErro,
          detalhes: registro.detalhes
        })).sort((a, b) => new Date(b.data) - new Date(a.data)) // Ordena do mais recente para o mais antigo
      };
    });

    res.json({
      success: true,
      historico: historicoFormatado,
      totalVersoes: historicoFormatado.length
    });
    
  } catch (err) {
    console.error('Erro ao buscar histórico:', err);
    res.status(500).json({ 
      success: false,
      erro: 'Erro ao buscar histórico',
      detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

exports.enviarEmailLaudo = async (req, res) => {
  let laudo;
  try {
    const { id } = req.params;
    const usuarioId = req.usuarioId;
    const usuarioNome = req.usuarioNome;

    laudo = await Laudo.findById(id)
      .populate({
        path: 'exame',
        populate: { path: 'paciente', select: 'nome email' }
      });

    if (!laudo) {
      return res.status(404).json({ erro: 'Laudo não encontrado' });
    }

    if (!laudo.laudoAssinado) {
      return res.status(400).json({ erro: 'Laudo não está assinado' });
    }

    if (!laudo.exame?.paciente?.email) {
      return res.status(400).json({ erro: 'Paciente não possui e-mail cadastrado' });
    }

    // Adiciona esta verificação para garantir que existe código de acesso
    if (!laudo.codigoAcesso) {
      return res.status(400).json({ erro: 'Laudo não possui código de acesso público' });
    }

    // Adiciona o código de acesso como parâmetro
    await sendMedicalReport(
      laudo.exame.paciente.email,
      laudo.exame.paciente.nome,
      laudo._id.toString(),
      laudo.laudoAssinado,
      laudo.codigoAcesso // Passa o código de acesso
    );

    // Atualiza o histórico
    laudo.dataEnvioEmail = new Date();
    laudo.destinatarioEmail = laudo.exame.paciente.email;
    laudo.historico.push({
      usuario: usuarioId,
      nomeUsuario: usuarioNome,
      acao: 'EnvioEmail',
      detalhes: `Laudo enviado para ${laudo.exame.paciente.email} com link público`,
      statusEnvio: 'Enviado',
      data: new Date()
    });

    await laudo.save();

    res.status(200).json({
      mensagem: 'E-mail enviado com sucesso',
      destinatario: laudo.exame.paciente.email
    });

  } catch (err) {
    logger.error('Erro ao enviar e-mail:', err);
    
    // Registra falha no histórico se o laudo foi encontrado
    if (laudo) {
      laudo.historico.push({
        usuario: req.usuarioId,
        nomeUsuario: req.usuarioNome,
        acao: 'EnvioEmail',
        detalhes: 'Falha no envio do e-mail',
        statusEnvio: 'Falha',
        mensagemErro: err.message,
        data: new Date()
      });
      await laudo.save();
    }

    res.status(500).json({ 
      erro: 'Erro ao enviar e-mail',
      detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

exports.visualizarLaudoPublico = async (req, res) => {
  try {
    const { id } = req.params;
    
    const laudo = await Laudo.findById(id).populate({
      path: 'exame',
      populate: {
        path: 'paciente',
        select: 'nome dataNascimento'
      }
    });
    
    if (!laudo) {
      return res.status(404).json({ 
        message: 'Laudo não encontrado ou inválido',
        codigo: 'LAUDO_INVALIDO_OU_NAO_ENCONTRADO'
      });
    }

    // Calcula idade do paciente
    const idade = laudo.exame.paciente?.dataNascimento ? 
      calcularIdade(laudo.exame.paciente.dataNascimento) : null;

    // Determina status (ativo/inativo)
    const status = laudo.status === 'Laudo assinado' ? 'ativo' : 'inativo';

    // Retorna os dados formatados para visualização pública
    const laudoPublico = {
      id: laudo._id,
      paciente: {
        nome: laudo.exame.paciente?.nome || 'Não informado',
        idade: idade ? `${idade} anos` : 'Não informada',
        dataNascimento: laudo.exame.paciente?.dataNascimento
      },
      exame: {
        tipo: laudo.exame.tipoExame || 'Não informado',
        data: laudo.exame.dataExame,
        id: laudo.exame._id
      },
      medico: laudo.medicoResponsavel || 'Não informado',
      conclusao: laudo.conclusao,
      dataEmissao: laudo.createdAt,
      versao: laudo.versao,
      status: status,
      valido: laudo.valido,
      temPdfAssinado: !!laudo.pdfAssinado, // Indica se tem PDF assinado
      codigoValidacao: laudo._id.toString().substring(0, 8)
    };

    res.json(laudoPublico);
  } catch (error) {
    console.error('Erro na visualização pública do laudo:', error);
    res.status(500).json({ 
      message: 'Erro ao recuperar laudo',
      codigo: 'ERRO_INTERNO'
    });
  }
};

exports.invalidarLaudo = async (req, res) => {
  try {
    const { id } = req.params;
    const { motivo } = req.body;
    const usuarioId = req.usuarioId;
    const usuarioNome = req.usuarioNome;

    const laudo = await Laudo.findById(id);
    
    if (!laudo) {
      return res.status(404).json({ erro: 'Laudo não encontrado' });
    }

    if (!laudo.valido) {
      return res.status(400).json({ erro: 'Laudo já está inválido' });
    }

    // Atualiza o laudo
    laudo.valido = false;
    laudo.motivoInvalidacao = motivo;
    laudo.atualizadoPor = usuarioNome;
    laudo.atualizadoPorId = usuarioId;
    
    // Registra no histórico
    laudo.historico.push({
      usuario: usuarioId,
      nomeUsuario: usuarioNome,
      acao: 'Invalidacao',
      detalhes: motivo || 'Laudo marcado como inválido',
      data: new Date()
    });

    await laudo.save();

    res.status(200).json({
      mensagem: 'Laudo marcado como inválido com sucesso',
      laudo: {
        id: laudo._id,
        valido: laudo.valido,
        motivoInvalidacao: laudo.motivoInvalidacao
      }
    });
  } catch (err) {
    res.status(500).json({ 
      erro: 'Erro ao invalidar laudo',
      detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

exports.gerarRelatorio = async (req, res) => {
  try {
    // Extrair parâmetros de consulta
    const {
      medicoId = '',
      tipoExame = '',
      status = '',
      dataInicio,
      dataFim
    } = req.query;

    // Validação obrigatória das datas
    if (!dataInicio || !dataFim) {
      return res.status(400).json({
        success: false,
        error: 'Datas de início e fim são obrigatórias'
      });
    }

    // Converter e validar as datas
    const startDate = new Date(dataInicio);
    startDate.setHours(0, 0, 0, 0); // Início do dia
    
    const endDate = new Date(dataFim);
    endDate.setHours(23, 59, 59, 999); // Fim do dia

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: 'Formato de data inválido'
      });
    }

    // Construir filtro básico com as datas
    const filtro = {
      createdAt: {
        $gte: startDate,
        $lte: endDate
      }
    };

    // Validação segura do médicoId
    if (medicoId && medicoId.trim() !== '') {
      if (!mongoose.Types.ObjectId.isValid(medicoId)) {
        return res.status(400).json({
          success: false,
          error: 'ID do médico inválido'
        });
      }
      filtro.medicoResponsavelId = new mongoose.Types.ObjectId(medicoId);
    }

    // Adicionar outros filtros
    if (tipoExame && tipoExame.trim() !== '') {
      filtro['exame.tipoExame'] = tipoExame.trim();
    }

    if (status && status.trim() !== '') {
      const statusValidos = [
        'Rascunho', 'Laudo em processamento', 'Laudo realizado',
        'Laudo assinado', 'Laudo refeito', 'Cancelado',
        'Erro ao gerar PDF', 'Erro no envio'
      ];
      
      if (!statusValidos.includes(status)) {
        return res.status(400).json({
          success: false,
          error: 'Status de laudo inválido',
          validStatuses: statusValidos
        });
      }
      filtro.status = status;
    }

    // Buscar todos os laudos sem paginação
    const laudos = await Laudo.find(filtro)
      .populate({
        path: 'exame',
        select: 'tipoExame paciente',
        populate: { 
          path: 'paciente', 
          select: 'nome cpf',
          transform: doc => {
            if (doc) {
              return {
                _id: doc._id,
                nome: doc.nome, // Já descriptografado pelo schema do Paciente
                cpf: doc.cpf    // Já descriptografado pelo schema do Paciente
              };
            }
            return doc;
          }
        }
      })
      .populate('medicoResponsavelId', 'nome')
      .sort({ createdAt: -1 });

    // Processar os laudos para aplicar a descriptografia
    const laudosProcessados = laudos.map(laudo => {
      const laudoObj = laudo.toObject(); // Isso aplica os getters do schema
      
      return {
        ...laudoObj,
        id: laudoObj._id.toString(),
        _id: undefined,
        medico: laudoObj.medicoResponsavelId?.nome || laudoObj.medicoResponsavel,
        paciente: laudoObj.exame?.paciente?.nome || 'Paciente não informado',
        tipoExame: laudoObj.exame?.tipoExame || 'Tipo não informado',
        dataCriacao: laudoObj.createdAt?.toISOString(),
        dataAtualizacao: laudoObj.updatedAt?.toISOString()
      };
    });

    // Contagem de status - abordagem alternativa sem agregação complexa
    const statusCounts = {
      'Laudo assinado': 0,
      'Laudo realizado': 0,
      'Cancelado': 0
    };

    laudosProcessados.forEach(laudo => {
      if (laudo.status === 'Laudo assinado') statusCounts['Laudo assinado']++;
      else if (laudo.status === 'Laudo realizado') statusCounts['Laudo realizado']++;
      else if (laudo.status === 'Cancelado') statusCounts['Cancelado']++;
    });

    // Construir resposta
    const response = {
      success: true,
      data: {
        laudos: laudosProcessados,
        totais: {
          quantidade: laudosProcessados.length,
          assinados: statusCounts['Laudo assinado'],
          pendentes: statusCounts['Laudo realizado'],
          cancelados: statusCounts['Cancelado']
        },
        periodo: {
          inicio: startDate.toISOString(),
          fim: endDate.toISOString()
        }
      }
    };

    res.status(200).json(response);

  } catch (error) {
    console.error('Erro no relatório:', error);
    
    // Tratamento específico para erros de conversão
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        error: 'Erro de conversão de tipo',
        path: error.path,
        value: error.value,
        message: `Não foi possível converter '${error.value}' para ${error.kind}`
      });
    }

    // Resposta genérica para outros erros
    res.status(500).json({
      success: false,
      error: 'Erro interno no servidor',
      ...(process.env.NODE_ENV === 'development' && {
        details: error.message,
        stack: error.stack
      })
    });
  }
};

exports.relatorioPdf = async (req, res) => {
  try {
    // Extrair parâmetros da query
    const {
      medicoId = '',
      tipoExame = '',
      status = '',
      dataInicio,
      dataFim
    } = req.query;

    // Validação obrigatória das datas
    if (!dataInicio || !dataFim) {
      return res.status(400).json({
        success: false,
        error: 'Datas de início e fim são obrigatórias'
      });
    }

    // Converter e validar as datas
    const startDate = new Date(dataInicio);
    const endDate = new Date(dataFim);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: 'Formato de data inválido'
      });
    }

    // Ajustar para cobrir o dia inteiro
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);

    // Construir filtro
    const filtro = {
      createdAt: {
        $gte: startDate,
        $lte: endDate
      }
    };

    // Filtros adicionais
    if (medicoId && medicoId.trim() !== '') {
      if (!mongoose.Types.ObjectId.isValid(medicoId)) {
        return res.status(400).json({
          success: false,
          error: 'ID do médico inválido'
        });
      }
      filtro.medicoResponsavelId = new mongoose.Types.ObjectId(medicoId);
    }

    if (tipoExame && tipoExame.trim() !== '') {
      filtro['exame.tipoExame'] = tipoExame.trim();
    }

    if (status && status.trim() !== '') {
      filtro.status = status;
    }

    // Buscar os dados
    const laudos = await Laudo.find(filtro)
      .populate({
        path: 'exame',
        select: 'tipoExame paciente',
        populate: { 
          path: 'paciente', 
          select: 'nome cpf',
          transform: doc => {
            if (doc) {
              return {
                _id: doc._id,
                nome: doc.nome,
                cpf: doc.cpf
              };
            }
            return doc;
          }
        }
      })
      .populate('medicoResponsavelId', 'nome')
      .sort({ createdAt: -1 });

    // Processar os laudos para aplicar a descriptografia
    const laudosProcessados = laudos.map(laudo => laudo.toObject());

    // Contagem de status
    const statusCounts = {
      'Laudo assinado': 0,
      'Laudo realizado': 0,
      'Cancelado': 0
    };

    laudosProcessados.forEach(laudo => {
      if (laudo.status === 'Laudo assinado') statusCounts['Laudo assinado']++;
      else if (laudo.status === 'Laudo realizado') statusCounts['Laudo realizado']++;
      else if (laudo.status === 'Cancelado') statusCounts['Cancelado']++;
    });

    const totalLaudos = laudosProcessados.length;

    // Criar o documento PDF
    const doc = new PDFDocument({ margin: 50, size: 'A4' });

    // Configurar headers para download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition', 
      `attachment; filename=relatorio_laudos_${startDate.toISOString().split('T')[0]}_a_${endDate.toISOString().split('T')[0]}.pdf`
    );

    // Pipe do PDF para a resposta
    doc.pipe(res);

    // Cabeçalho do PDF
    doc.fontSize(20)
       .font('Helvetica-Bold')
       .text('Relatório de Laudos Médicos', { align: 'center' });
    doc.moveDown();

    // Período do relatório (datas específicas)
    const formatDate = (date) => date.toLocaleDateString('pt-BR');
    
    doc.fontSize(12)
       .font('Helvetica')
       .text(`Período: ${formatDate(startDate)} a ${formatDate(endDate)}`, { align: 'center' });
    
    doc.text(`Data de geração: ${new Date().toLocaleDateString('pt-BR')}`, { align: 'center' });
    doc.moveDown();

    // Resumo estatístico
    doc.fontSize(14)
       .font('Helvetica-Bold')
       .text('Resumo Estatístico', { underline: true });
    doc.moveDown(0.5);
    
    doc.font('Helvetica')
       .text(`Total de Laudos: ${totalLaudos}`);
    doc.text(`Laudos Assinados: ${statusCounts['Laudo assinado']}`);
    doc.text(`Laudos Pendentes: ${statusCounts['Laudo realizado']}`);
    doc.text(`Laudos Cancelados: ${statusCounts['Cancelado']}`);
    doc.moveDown();

    // Tabela de laudos
    doc.fontSize(14)
       .font('Helvetica-Bold')
       .text('Detalhes dos Laudos', { underline: true });
    doc.moveDown(0.5);

    // Configurar tabela
    const tableTop = doc.y;
    const colWidths = [80, 150, 150, 120]; // Larguras das colunas
    const rowHeight = 20;

    // Cabeçalho da tabela
    doc.font('Helvetica-Bold');
    doc.text('Data', 50, tableTop);
    doc.text('Paciente', 50 + colWidths[0], tableTop);
    doc.text('Médico', 50 + colWidths[0] + colWidths[1], tableTop);
    doc.text('Status', 50 + colWidths[0] + colWidths[1] + colWidths[2], tableTop);
    doc.moveDown(0.5);

    // Linhas da tabela
    doc.font('Helvetica');
    laudosProcessados.forEach((laudo, index) => {
      const y = tableTop + (index + 1) * rowHeight;
      
      // Data
      doc.text(
        new Date(laudo.createdAt).toLocaleDateString('pt-BR'), 
        50, y
      );
      
      // Paciente
      doc.text(
        laudo.exame?.paciente?.nome || '-', 
        50 + colWidths[0], y,
        { width: colWidths[1] - 10, ellipsis: true }
      );
      
      // Médico
      doc.text(
        laudo.medicoResponsavelId?.nome || laudo.medicoResponsavel || '-', 
        50 + colWidths[0] + colWidths[1], y,
        { width: colWidths[2] - 10, ellipsis: true }
      );
      
      // Status com cor
      const status = laudo.status || '-';
      if (status.includes('assinado')) {
        doc.fillColor('green');
      } else if (status.includes('Cancelado')) {
        doc.fillColor('red');
      } else {
        doc.fillColor('black');
      }
      
      doc.text(
        status, 
        50 + colWidths[0] + colWidths[1] + colWidths[2], y,
        { width: colWidths[3] - 10, ellipsis: true }
      );
      doc.fillColor('black'); // Resetar cor
    });

    // Finalizar o documento
    doc.end();

  } catch (error) {
    console.error('Erro ao gerar PDF:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao gerar PDF',
      ...(process.env.NODE_ENV === 'development' && {
        details: error.message
      })
    });
  }
};

// Novo controller
exports.listarLaudosPorPaciente = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const pagina = parseInt(page);
    const limite = parseInt(limit);

    // Primeiro encontre todos os exames do paciente
    const examesDoPaciente = await Exame.find({ paciente: id }).select('_id');

    // Extraia apenas os IDs dos exames
    const examesIds = examesDoPaciente.map(exame => exame._id);

    // Agora busque os laudos que referenciam esses exames
    const laudos = await Laudo.find({ exame: { $in: examesIds } })
      .populate({
        path: 'exame',
        populate: {
          path: 'paciente',
          select: 'nome'
        }
      })
      .sort({ createdAt: -1 })
      .skip((pagina - 1) * limite)
      .limit(limite);

    const totalLaudos = await Laudo.countDocuments({ exame: { $in: examesIds } });

    res.status(200).json({
      laudos,
      paginaAtual: pagina,
      totalPaginas: Math.ceil(totalLaudos / limite),
      totalLaudos,
    });
  } catch (err) {
    res.status(500).json({ 
      erro: 'Erro ao buscar laudos do paciente',
      detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

exports.autenticarLaudoPublico = async (req, res) => {
  try {
    const { id } = req.params;
    const { codigoAcesso } = req.body;

    // Verifique se o laudo existe e está ativo
    const laudo = await Laudo.findById(id)

    if (!laudo) {
      return res.status(404).json({
        authenticated: false,
        message: 'Laudo não encontrado ou inválido'
      });
    }

    // Verifique o código de acesso
    if (laudo.codigoAcesso !== codigoAcesso) {
      return res.status(401).json({
        authenticated: false,
        message: 'Código de acesso inválido'
      });
    }

    // Se chegou aqui, a autenticação foi bem-sucedida
    res.json({
      authenticated: true,
      message: 'Autenticação bem-sucedida'
    });

  } catch (error) {
    console.error('Erro na autenticação do laudo público:', error);
    res.status(500).json({
      authenticated: false,
      message: 'Erro durante a autenticação'
    });
  }
};