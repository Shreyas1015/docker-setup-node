const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const FinancialRecord = sequelize.define(
    'FinancialRecord',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      amount: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      type: {
        type: DataTypes.ENUM('INCOME', 'EXPENSE'),
        allowNull: false,
      },
      category: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      createdBy: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'created_by',
      },
    },
    {
      tableName: 'financial_record',
      paranoid: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      deletedAt: 'deleted_at',
      indexes: [
        { fields: ['type'] },
        { fields: ['date'] },
        { fields: ['category'] },
        { fields: ['type', 'date'] },
        { fields: ['created_by'] },
      ],
    }
  );

  FinancialRecord.associate = (models) => {
    FinancialRecord.belongsTo(models.User, {
      foreignKey: 'created_by',
      as: 'creator',
      onDelete: 'RESTRICT',
    });
  };

  return FinancialRecord;
};
