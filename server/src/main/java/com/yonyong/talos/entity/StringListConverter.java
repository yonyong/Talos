package com.yonyong.talos.entity;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;

/**
 * 把 List<String> 与数据库逗号分隔字符串互转，用于 t_user.bizCodes 这类多值字段。
 * 空集合 <-> 空串；忽略空白项并去重。
 */
@Converter
public class StringListConverter implements AttributeConverter<List<String>, String> {

    private static final String SEP = ",";

    @Override
    public String convertToDatabaseColumn(List<String> list) {
        if (list == null || list.isEmpty()) return "";
        return list.stream()
                .filter(s -> s != null && !s.isBlank())
                .map(String::trim)
                .distinct()
                .collect(Collectors.joining(SEP));
    }

    @Override
    public List<String> convertToEntityAttribute(String dbData) {
        if (dbData == null || dbData.isBlank()) return new ArrayList<>();
        return new ArrayList<>(Arrays.asList(dbData.split(SEP)));
    }
}
